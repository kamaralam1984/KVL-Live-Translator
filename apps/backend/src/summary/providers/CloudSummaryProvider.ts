import type { SummaryProvider, SummaryProviderCapabilities, SummaryProviderConfig, SummaryProviderStatus, SummaryRequest, SummaryResult } from '@kvl/summary';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 20_000; // summaries process more text than a single sentence — a bit more headroom
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

/** A 2-hour meeting's LLM call costs the same as a 15-minute one — the
 * actual mechanism behind "long meetings don't cause cost/memory blowup"
 * for the AI-synthesis half of this phase (the confirmed-facts sections
 * are an indexed DB query, unaffected by length either way). */
export const MAX_TRANSCRIPT_CHARS = 12_000;

/** Exported separately so it's unit-testable without a network call. Takes
 * the most recent text within the cap — what a meeting concluded with
 * usually matters most for summarizing it. */
export function truncateTranscript(text: string, maxChars: number = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface RawSummaryJson {
  executiveSummary?: string;
  meetingObjective?: string;
  keyDiscussionPoints?: string[];
  suggestedNextSteps?: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same retryable-error policy as CloudExplanationProvider.ts/CloudCopilotProvider.ts. */
function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /^Cloud summary request failed \(5\d\d\)/.test(error.message)) return true;
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
 * OpenAI-compatible chat-completions client — synthesizes the 4 prose
 * fields only (the other 7 summary sections are a live DB query, see
 * SummaryManager.ts). Same request/retry shape as
 * CloudExplanationProvider.ts/CloudCopilotProvider.ts.
 */
export class CloudSummaryProvider implements SummaryProvider {
  readonly id = 'cloud-summary';
  readonly displayName = 'Cloud Summary';

  private status: SummaryProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: SummaryProviderConfig): Promise<void> {
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

  async synthesize(request: SummaryRequest): Promise<SummaryResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudSummaryProvider is not configured (no API key)');

    this.status = 'busy';
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await this.attemptSynthesize(request);
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

  private async attemptSynthesize(request: SummaryRequest): Promise<SummaryResult> {
    const transcript = truncateTranscript(request.transcriptText);

    const systemPrompt = [
      'You write a structured summary of a business meeting transcript.',
      'CRITICAL: base your summary ONLY on the given transcript. Never invent facts, names, numbers, or decisions not actually present in it.',
      'If the transcript is too sparse to confidently produce a field, say so plainly rather than guessing.',
      'Respond with ONLY a JSON object with these exact keys:',
      '"executiveSummary" (2-4 sentences, the overall gist),',
      '"meetingObjective" (1-2 sentences, what this meeting was actually for),',
      '"keyDiscussionPoints" (an array of short bullet strings, the real topics covered),',
      '"suggestedNextSteps" (an array of short bullet strings — reasonable next steps grounded in what was actually discussed).',
      'No markdown, no explanation outside the JSON.',
    ].join(' ');

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: transcript },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Cloud summary request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    }

    if (response.status === 429) throw new Error('Cloud summary rate limit exceeded (429)');
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud summary request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as RawSummaryJson;

    if (!parsed.executiveSummary) throw new Error('Cloud summary returned no executiveSummary field');

    return {
      executiveSummary: parsed.executiveSummary,
      meetingObjective: parsed.meetingObjective ?? 'Not enough context to tell.',
      keyDiscussionPoints: parsed.keyDiscussionPoints ?? [],
      suggestedNextSteps: parsed.suggestedNextSteps ?? [],
    };
  }

  getStatus(): SummaryProviderStatus {
    return this.status;
  }

  getCapabilities(): SummaryProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
    };
  }
}
