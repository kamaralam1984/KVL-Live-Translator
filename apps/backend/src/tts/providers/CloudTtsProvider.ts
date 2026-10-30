import type { TtsProvider, TtsProviderCapabilities, TtsProviderConfig, TtsProviderStatus, TtsRequest, TtsResult, VoiceInfo } from '@kvl/tts';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'tts-1';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TEXT_LENGTH = 4_096; // OpenAI's /audio/speech input cap

/** OpenAI's TTS voice set is fixed — no endpoint exists to enumerate it,
 * so this is a small, honestly-static list, not a live query. */
const FIXED_VOICES: VoiceInfo[] = [
  { id: 'alloy', name: 'Alloy', languageCode: 'en', gender: 'neutral' },
  { id: 'echo', name: 'Echo', languageCode: 'en', gender: 'male' },
  { id: 'fable', name: 'Fable', languageCode: 'en', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', languageCode: 'en', gender: 'male' },
  { id: 'nova', name: 'Nova', languageCode: 'en', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', languageCode: 'en', gender: 'female' },
];

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
 * OpenAI-compatible `/audio/speech` client — same key-handoff pattern as
 * CloudSpeechProvider.ts/CloudResponseProvider.ts (the caller already holds
 * a decrypted key by the time start() is called). Rejects over-length input
 * outright rather than silently truncating (see the Phase 7 plan's
 * "technical terminology" test requirement).
 */
export class CloudTtsProvider implements TtsProvider {
  readonly id = 'cloud-tts';
  readonly displayName = 'Cloud TTS';
  readonly tier = 'cloud' as const;

  private status: TtsProviderStatus = 'unavailable';
  private apiKey: string | undefined;
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private available = false;

  async start(config: TtsProviderConfig): Promise<void> {
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

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (!this.available || !this.apiKey) throw new Error('CloudTtsProvider is not configured (no API key)');
    if (request.text.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text too long for CloudTtsProvider (${request.text.length} > ${MAX_TEXT_LENGTH} characters)`);
    }

    this.status = 'busy';
    try {
      const voice = FIXED_VOICES.some((v) => v.id === request.voiceId) ? request.voiceId : FIXED_VOICES[0].id;

      let response: Response;
      try {
        response = await fetchWithTimeout(`${this.baseUrl}/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            voice,
            input: request.text,
            speed: request.speed ? Math.max(0.25, Math.min(4, request.speed)) : undefined,
            response_format: 'mp3',
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error(`Cloud TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw error;
      }

      if (response.status === 429) throw new Error('Cloud TTS rate limit exceeded (429)');
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Cloud TTS request failed (${response.status}): ${body.slice(0, 300)}`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      return { audio, mimeType: 'audio/mpeg' };
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return FIXED_VOICES;
  }

  getStatus(): TtsProviderStatus {
    return this.status;
  }

  getCapabilities(): TtsProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: false,
      requiresApiKey: true,
      tier: this.tier,
      maxTextLength: MAX_TEXT_LENGTH,
    };
  }
}
