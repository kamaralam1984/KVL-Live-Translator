import type {
  ResponseProvider,
  ResponseProviderCapabilities,
  ResponseProviderConfig,
  ResponseProviderStatus,
  ResponseRequest,
  ResponseResult,
} from '@kvl/response';
import { getStyleInstruction, ALL_RESPONSE_STYLES } from '../ResponseStyleEngine';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2; // one real attempt + one retry
const RETRY_DELAY_MS = 500;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for errors worth a bounded retry — network failures, aborts (our
 * own timeout), and 5xx. Never retries 4xx (auth/request errors are real,
 * not transient, and hammering them just burns quota). */
function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /^Cloud response request failed \(5\d\d\)/.test(error.message)) return true;
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
 * OpenAI-compatible chat-completions client, hi/hinglish -> professional
 * English. Same request shape as CloudTranslationProvider.ts (Phase 4), but
 * this is the only provider in this file's tree with a real fetch timeout +
 * bounded retry — the phase's explicit "timeout and retry" requirement,
 * new here since nothing upstream (including CloudTranslationProvider) has
 * it yet. Only provider claiming all 7 ResponseStyles.
 */
export class CloudResponseProvider implements ResponseProvider {
  readonly id = 'cloud-response';
  readonly displayName = 'Cloud Response';
  readonly tier = 'paid' as const;

  private status: ResponseProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: ResponseProviderConfig): Promise<void> {
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

  async generate(request: ResponseRequest): Promise<ResponseResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudResponseProvider is not configured (no API key)');

    this.status = 'busy';
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          return await this.attemptGenerate(request);
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

  private async attemptGenerate(request: ResponseRequest): Promise<ResponseResult> {
    const systemPrompt = [
      'You are helping a non-native English speaker draft a professional reply for a work meeting.',
      'The input is spoken or typed Hindi/Hinglish (Hindi-English code-mixed). Understand it, then produce a natural English rewrite.',
      getStyleInstruction(request.style),
      'Preserve any tokens that look like KVLTERM0X, KVLTERM1X, etc. exactly as-is — do not translate, alter, or remove them, they are protected terminology placeholders.',
      'Respond with ONLY a JSON object: {"englishText": "..."}. No markdown, no explanation.',
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
            { role: 'user', content: request.text },
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Cloud response request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    }

    if (response.status === 429) throw new Error('Cloud response rate limit exceeded (429)');
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cloud response request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { englishText?: string };

    if (!parsed.englishText) throw new Error('Cloud response returned no englishText field');

    return { englishText: parsed.englishText };
  }

  getStatus(): ResponseProviderStatus {
    return this.status;
  }

  getCapabilities(): ResponseProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
      tier: this.tier,
      supportedStyles: ALL_RESPONSE_STYLES,
    };
  }
}
