import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderConfig,
  TranslationProviderStatus,
  TranslationRequest,
  TranslationResult,
} from '@kvl/translation';
import { applyHinglishIfRequested } from '../transliterate';
import { childLogger } from '../../logger';

const log = childLogger('libretranslate');
const DEFAULT_BASE_URL = 'https://libretranslate.com';
const AVAILABILITY_CHECK_TIMEOUT_MS = 4_000;

interface LibreTranslateResponse {
  translatedText?: string;
  error?: string;
}

/**
 * REST client for a LibreTranslate-compatible endpoint — self-hosted (fully
 * free/offline-on-your-network) or the public instance (free tier, some
 * mirrors require an API key for higher limits). Availability is checked by
 * actually reaching `${baseUrl}/languages` at startup, not assumed —
 * genuinely testable if the endpoint is reachable from wherever this runs.
 */
export class LibreTranslateProvider implements TranslationProvider {
  readonly id = 'libretranslate';
  readonly displayName = 'LibreTranslate';
  readonly tier = 'free' as const;

  private status: TranslationProviderStatus = 'unavailable';
  private baseUrl = DEFAULT_BASE_URL;
  private apiKey: string | undefined;
  private available = false;

  async start(config: TranslationProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.available = await this.checkAvailability();
    this.status = this.available ? 'ready' : 'unavailable';
    if (!this.available) {
      log.warn({ baseUrl: this.baseUrl }, 'LibreTranslateProvider unavailable — endpoint unreachable');
    }
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
    this.available = false;
  }

  private async checkAvailability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AVAILABILITY_CHECK_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/languages`, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (!this.available) throw new Error('LibreTranslateProvider is not available');

    this.status = 'busy';
    try {
      const response = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: request.text,
          source: request.sourceLang,
          target: request.targetLang,
          format: 'text',
          ...(this.apiKey ? { api_key: this.apiKey } : {}),
        }),
      });

      if (response.status === 429) throw new Error('LibreTranslate rate limit exceeded (429)');
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`LibreTranslate request failed (${response.status}): ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as LibreTranslateResponse;
      if (!data.translatedText) throw new Error(data.error || 'LibreTranslate returned no translation');

      return { translatedText: applyHinglishIfRequested(data.translatedText, request.mode) };
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
      requiresApiKey: false,
      tier: this.tier,
      supportedModes: ['hindi', 'hinglish'],
    };
  }
}
