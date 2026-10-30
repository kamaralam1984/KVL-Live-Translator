import type {
  ExplanationProvider,
  ExplanationProviderCapabilities,
  ExplanationProviderConfig,
  ExplanationProviderStatus,
  ExplanationRequest,
  ExplanationResult,
} from '@kvl/explain';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2; // one real attempt + one retry
const RETRY_DELAY_MS = 500;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface CloudExplanationJson {
  simpleMeaning?: string;
  whatTheyAreAsking?: string;
  importantContext?: string;
  terms?: Array<{ term?: string; definition?: string }>;
  suggestedResponse?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same retryable-error policy as CloudResponseProvider.ts — network
 * failures, our own timeout, and 5xx are worth a bounded retry; 4xx
 * (auth/request errors) are real and not transient. */
function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /^Cloud explanation request failed \(5\d\d\)/.test(error.message)) return true;
  if (error instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message)) return true;
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OpenAI-compatible chat-completions client — same request/retry shape as
 * CloudResponseProvider.ts (Phase 6)/CloudTtsProvider.ts (Phase 7). The
 * system prompt is where "never invent meeting facts" is actually
 * enforced: the model is told to use only the given sentence/context and
 * to say so plainly when a field can't be derived, rather than guess.
 */
export class CloudExplanationProvider implements ExplanationProvider {
  readonly id = 'cloud-explanation';
  readonly displayName = 'Cloud Explanation';
  readonly tier = 'cloud' as const;

  private status: ExplanationProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: ExplanationProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
    this.available = Boolean(this.apiKey);
    this.status = this.available ? 'ready' : 'unavailable';
  }

  async stop(): Promise<void> {
    this.apiKey = undefined;
    this.available = false;
    this.status = 'unavailable';
  }

  async explain(request: ExplanationRequest): Promise<ExplanationResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudExplanationProvider is not configured (no API key)');

    this.status = 'busy';
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await this.attemptExplain(request);
        } catch (error) {
          lastError = error;
          if (attempt < MAX_ATTEMPTS && isRetryable(error)) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          throw error;
        }
      }
      throw lastError;
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  private async attemptExplain(request: ExplanationRequest): Promise<ExplanationResult> {
    const systemPrompt = [
      'You help a non-native English speaker understand a sentence from a live business meeting, in simple Hindi/Hinglish.',
      'You will be given the sentence to explain and, if available, recent surrounding transcript as context.',
      'CRITICAL: base your answer ONLY on the given sentence and context. Never invent meeting facts, names, numbers, or decisions that were not actually said.',
      'If a field genuinely cannot be determined from what was given, say so plainly (e.g. "Not enough context to tell") rather than guessing.',
      'Respond with ONLY a JSON object with these exact keys:',
      '"simpleMeaning" (the sentence explained simply, in Hindi/Hinglish — Hindi-English code-mixed, Roman script),',
      '"whatTheyAreAsking" (what the speaker wants/is asking for, in Hindi/Hinglish),',
      '"importantContext" (any relevant context from the surrounding transcript that helps understand this sentence, in Hindi/Hinglish; if none is relevant, say so),',
      '"terms" (an array of {"term","definition"} for any technical/business terms in the sentence worth explaining — empty array if none),',
      '"suggestedResponse" (a short, professional English reply the listener could give back).',
      'No markdown, no explanation outside the JSON.',
    ].join(' ');

    const userContent = [`Sentence to explain: "${request.sentence}"`, request.contextSegments.length > 1 ? `\nRecent context (oldest first):\n${request.contextSegments.join('\n')}` : ''].join('');

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Cloud explanation request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    }

    if (response.status === 429) throw new Error('Cloud explanation rate limit exceeded (429)');
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud explanation request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as CloudExplanationJson;

    if (!parsed.simpleMeaning) throw new Error('Cloud explanation returned no simpleMeaning field');

    return {
      simpleMeaning: parsed.simpleMeaning,
      whatTheyAreAsking: parsed.whatTheyAreAsking ?? 'Not enough context to tell.',
      importantContext: parsed.importantContext ?? 'Not enough context to tell.',
      terms: (parsed.terms ?? []).filter((t): t is { term: string; definition: string } => Boolean(t.term && t.definition)),
      suggestedResponse: parsed.suggestedResponse ?? '',
    };
  }

  getStatus(): ExplanationProviderStatus {
    return this.status;
  }

  getCapabilities(): ExplanationProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
      tier: this.tier,
    };
  }
}
