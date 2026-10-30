import type { ResponseStyle } from '@kvl/shared';
import { ResponseRouter } from './ResponseRouter';
import { ResponseSpeechService } from './ResponseSpeechService';
import { LocalResponsePhrasebookProvider } from './providers/LocalResponsePhrasebookProvider';
import { ArgosResponseProvider } from './providers/ArgosResponseProvider';
import { LibreTranslateResponseProvider } from './providers/LibreTranslateResponseProvider';
import { CloudResponseProvider } from './providers/CloudResponseProvider';
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { responseHistoryRepository } from '../db/repositories/responseHistoryRepository';
import { speechManager } from '../speech/SpeechManager';
import { broadcast } from '../ws/connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { RequestCache } from '../cost/RequestCache';
import type { ResponseRouterResult } from './ResponseRouter';
import { childLogger } from '../logger';

const log = childLogger('response-manager');

/** The audio ResponseRecorder (renderer) always exports at this fixed
 * format — no need to send it over the wire per-message like audio:chunk
 * does, since (unlike meeting capture) this format never varies. */
const RESPONSE_AUDIO_SAMPLE_RATE_HZ = 16_000;
const RESPONSE_AUDIO_CHANNELS = 1;

/**
 * Orchestrates Phase 6's response pipeline: request/response driven (not an
 * event-bus subscription like Phase 4's continuous transcript flow), one
 * user action in, one broadcast out. Mirrors TranslationManager.ts's
 * provider-ownership/refreshCloudProvider shape exactly.
 */
export class ResponseManager {
  private readonly localProvider = new LocalResponsePhrasebookProvider();
  private readonly argosProvider = new ArgosResponseProvider();
  private readonly libreProvider = new LibreTranslateResponseProvider();
  private readonly cloudProvider = new CloudResponseProvider();
  private readonly providers = [this.localProvider, this.argosProvider, this.libreProvider, this.cloudProvider];
  private readonly cache = new RequestCache<ResponseRouterResult>();
  private readonly router = new ResponseRouter(this.providers, undefined, costGate, this.cache);
  private readonly speechService = new ResponseSpeechService(speechManager);

  /** Wired to the cache:clear WS message (Phase 11). */
  clearCache(): void {
    this.cache.clear();
  }

  async initialize(): Promise<void> {
    await this.localProvider.start({});
    await this.argosProvider.start({});
    await this.libreProvider.start({ baseUrl: process.env.LIBRETRANSLATE_BASE_URL });
    await this.refreshCloudProvider();
  }

  /** Re-reads the active 'response' provider config and (re)connects the
   * cloud provider. Falls back to the active 'translation' provider's key
   * if no dedicated 'response' provider is configured — deliberate, so this
   * works out of the box without asking the user to duplicate the same LLM
   * key under a second provider entry. Safe to call again after Settings
   * changes to either kind. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('response') ?? providersRepository.getActiveByKind('translation');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud response provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud response provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real generate() call through the already-active cloud
   * provider, for the API Providers "Test key" button. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.generate({ text: 'Namaste', style: 'professional' });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async transcribe(requestId: string, audioBase64: string, durationMs: number): Promise<void> {
    try {
      const outcome = await this.speechService.transcribe({
        sessionId: requestId,
        chunkId: requestId,
        sequenceNumber: 0,
        timestampMs: 0,
        durationMs,
        sampleRateHz: RESPONSE_AUDIO_SAMPLE_RATE_HZ,
        channelCount: RESPONSE_AUDIO_CHANNELS,
        audio: Buffer.from(audioBase64, 'base64'),
      });

      broadcast({ type: 'response:transcript', requestId, text: outcome.text, languageCode: outcome.languageCode });
      broadcast({ type: 'response:status', providerId: outcome.providerId, status: 'ready' });
    } catch (error) {
      log.error({ err: error, requestId }, 'response transcription failed');
      broadcast({ type: 'response:error', requestId, code: 'RESPONSE_STT_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'response:status', providerId: 'router', status: 'error' });
    }
  }

  async generate(requestId: string, sourceText: string, style: ResponseStyle): Promise<void> {
    if (!sourceText.trim()) {
      broadcast({ type: 'response:error', requestId, code: 'EMPTY_TEXT', message: 'Nothing to translate.' });
      return;
    }

    try {
      const outcome = await this.router.generateWithFallback({ text: sourceText, style });

      const dto = responseHistoryRepository.insert({
        sourceText,
        englishText: outcome.result.englishText,
        style,
        providerId: outcome.providerId,
        createdAt: new Date().toISOString(),
      });

      broadcast({ type: 'response:result', requestId, result: dto });
      broadcast({ type: 'response:status', providerId: outcome.providerId, status: 'ready' });

      if (!outcome.cacheHit) {
        const provider = this.providers.find((p) => p.id === outcome.providerId);
        const capabilities = provider?.getCapabilities();
        costManager.record({
          kind: 'response',
          providerId: capabilities?.requiresApiKey ? outcome.providerId : null,
          providerLabel: capabilities?.displayName ?? outcome.providerId,
          tier: capabilities?.tier ?? 'local',
          requiresApiKey: capabilities?.requiresApiKey ?? false,
          requestType: 'generate',
          inputUnits: sourceText.length,
          outputUnits: outcome.result.englishText.length,
          meetingSessionId: null, // My Response is usable standalone, outside any meeting
        });
      }
    } catch (error) {
      log.error({ err: error, requestId }, 'response generation failed');
      broadcast({ type: 'response:error', requestId, code: 'RESPONSE_GENERATE_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'response:status', providerId: 'router', status: 'error' });
    }
  }
}

export const responseManager = new ResponseManager();
