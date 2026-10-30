import type {
  CopilotBatchRequest,
  CopilotBatchResult,
  CopilotExtractedItem,
  CopilotProvider,
  CopilotProviderCapabilities,
  CopilotProviderConfig,
  CopilotProviderStatus,
} from '@kvl/copilot';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface RawExtractedItem {
  category?: string;
  description?: string;
  sourceText?: string;
  segmentIndex?: number;
  owner?: string;
  dueText?: string;
  confidence?: number;
}

const VALID_CATEGORIES = new Set([
  'decision',
  'action-item',
  'requirement',
  'objection',
  'pricing-discussion',
  'technical-requirement',
  'follow-up',
  'client-request',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Same retryable-error policy as CloudExplanationProvider.ts/
 * CloudResponseProvider.ts. */
function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /^Cloud copilot request failed \(5\d\d\)/.test(error.message)) return true;
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
 * OpenAI-compatible chat-completions client — batch analysis for the 8
 * categories only a real LLM can judge (Local handles question/deadline
 * separately, see EventDetector.ts). Same request/retry shape as
 * CloudExplanationProvider.ts. The system prompt is where the phase's own
 * "should is not automatically an action item" and "never guess an owner"
 * rules are actually enforced.
 */
export class CloudCopilotProvider implements CopilotProvider {
  readonly id = 'cloud-copilot';
  readonly displayName = 'Cloud Copilot';

  private status: CopilotProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: CopilotProviderConfig): Promise<void> {
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

  async analyzeBatch(request: CopilotBatchRequest): Promise<CopilotBatchResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudCopilotProvider is not configured (no API key)');

    this.status = 'busy';
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await this.attemptAnalyze(request);
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

  private async attemptAnalyze(request: CopilotBatchRequest): Promise<CopilotBatchResult> {
    const systemPrompt = [
      'You analyze a short window of a live business meeting transcript and extract only real, clearly-stated items.',
      'Categories: decision, action-item, requirement, objection, pricing-discussion, technical-requirement, follow-up, client-request.',
      'CRITICAL: only extract an action-item if the transcript actually indicates a real commitment or request being made — a sentence merely containing the word "should" is NOT automatically an action item.',
      'CRITICAL: never guess or invent an owner for an action-item or follow-up — only set "owner" if a specific person is clearly named as responsible; omit it otherwise.',
      'Never invent items, names, numbers, or facts not actually present in the transcript.',
      'Each transcript segment below is numbered starting at 0 — for every item you extract, set "segmentIndex" to the number of the segment it came from.',
      'Respond with ONLY a JSON object: {"items": [{"category","description","sourceText","segmentIndex","owner"?,"dueText"?,"confidence"?}]}. Empty items array if nothing qualifies. No markdown, no explanation.',
    ].join(' ');

    const userContent = request.segments.map((s, i) => `[${i}] ${s.text}`).join('\n');

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
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Cloud copilot request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    }

    if (response.status === 429) throw new Error('Cloud copilot rate limit exceeded (429)');
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud copilot request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { items?: RawExtractedItem[] };

    const items: CopilotExtractedItem[] = (parsed.items ?? [])
      .filter((raw): raw is Required<Pick<RawExtractedItem, 'category' | 'description' | 'sourceText' | 'segmentIndex'>> & RawExtractedItem =>
        Boolean(raw.category && VALID_CATEGORIES.has(raw.category) && raw.description && raw.sourceText && typeof raw.segmentIndex === 'number' && request.segments[raw.segmentIndex]),
      )
      .map((raw) => ({
        category: raw.category as CopilotExtractedItem['category'],
        description: raw.description,
        sourceText: raw.sourceText,
        segmentIndex: raw.segmentIndex,
        owner: raw.owner,
        dueText: raw.dueText,
        confidence: raw.confidence,
      }));

    return { items };
  }

  getStatus(): CopilotProviderStatus {
    return this.status;
  }

  getCapabilities(): CopilotProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
    };
  }
}
