import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderConfig,
  TranslationProviderStatus,
  TranslationRequest,
  TranslationResult,
} from '@kvl/translation';
import type { TranslationMode } from '@kvl/shared';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

const MODE_INSTRUCTIONS: Record<TranslationMode, string> = {
  hindi: 'Translate into formal, natural Hindi, written in Devanagari script.',
  hinglish:
    'Translate into casual Hinglish — Hindi-English code-mixed, written in Roman/Latin script, the way it is commonly typed in informal Indian chat/text messages. Not Devanagari.',
  'simple-hindi': 'Translate into simple, easy-to-understand Hindi (Devanagari script) using common everyday vocabulary, suitable for a beginner.',
  'simple-english': 'Rewrite into simplified, clear English using short sentences and common vocabulary, suitable for a non-native speaker. Do not translate to another language.',
};

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * OpenAI-compatible chat-completions client. The only provider capable of
 * genuine Hinglish/simplification (pure-NMT engines can't target those, see
 * the Phase 4 plan) — per-mode system prompts do the work. Same
 * key-handoff pattern as Phase 3's CloudSpeechProvider: the caller
 * (TranslationManager) already holds a decrypted key by the time start() is
 * called; this class never touches SQLite or the encrypted blob directly.
 */
export class CloudTranslationProvider implements TranslationProvider {
  readonly id = 'cloud-translation';
  readonly displayName = 'Cloud Translation';
  readonly tier = 'paid' as const;

  private status: TranslationProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: TranslationProviderConfig): Promise<void> {
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

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudTranslationProvider is not configured (no API key)');

    this.status = 'busy';
    try {
      const systemPrompt = [
        'You are a professional meeting interpreter for a business context.',
        MODE_INSTRUCTIONS[request.mode],
        'Preserve any tokens that look like KVLTERM0X, KVLTERM1X, etc. exactly as-is — do not translate, alter, or remove them, they are protected terminology placeholders.',
        'Also draft a short, professional suggested English reply the listener could send back.',
        'Respond with ONLY a JSON object: {"translation": "...", "suggestedReply": "..."}. No markdown, no explanation.',
      ].join(' ');

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: request.text },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      });

      if (response.status === 429) throw new Error('Cloud translation rate limit exceeded (429)');
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Cloud translation request failed (${response.status}): ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content) as { translation?: string; suggestedReply?: string };

      if (!parsed.translation) throw new Error('Cloud translation returned no translation field');

      return { translatedText: parsed.translation, suggestedReply: parsed.suggestedReply };
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  getStatus(): TranslationProviderStatus {
    return this.status;
  }

  getCapabilities(): TranslationProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
      tier: this.tier,
      supportedModes: ['hindi', 'hinglish', 'simple-hindi', 'simple-english'],
    };
  }
}
