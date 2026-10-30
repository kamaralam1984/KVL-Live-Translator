import type { TranscriptSegment, TranslationResultDTO } from '@kvl/shared';
import { TranslationRouter } from './TranslationRouter';
import { LocalTranslationProvider } from './providers/LocalTranslationProvider';
import { ArgosTranslateProvider } from './providers/ArgosTranslateProvider';
import { LibreTranslateProvider } from './providers/LibreTranslateProvider';
import { CloudTranslationProvider } from './providers/CloudTranslationProvider';
// Generic key-decrypt relay introduced in Phase 3 alongside CloudSpeechProvider
// — reused as-is, it isn't STT-specific (just providerId -> decrypted key).
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { sessionsRepository } from '../db/repositories/sessionsRepository';
import { historyRepository } from '../db/repositories/historyRepository';
import { broadcast } from '../ws/connectionRegistry';
import { backendEventBus } from '../events/backendEventBus';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { RequestCache } from '../cost/RequestCache';
import type { TranslationRouterResult } from './TranslationRouter';
import { childLogger } from '../logger';

const log = childLogger('translation-manager');

/**
 * Orchestrates Phase 4's translation pipeline: subscribes to
 * transcript:produced (emitted by Phase 3's SpeechManager), routes through
 * the local/free/paid provider chain, persists via the already-existing
 * (previously unused) historyRepository, and broadcasts the already-existing
 * translation:update message the UI already renders.
 */
export class TranslationManager {
  private readonly localProvider = new LocalTranslationProvider();
  private readonly argosProvider = new ArgosTranslateProvider();
  private readonly libreProvider = new LibreTranslateProvider();
  private readonly cloudProvider = new CloudTranslationProvider();
  private readonly providers = [this.localProvider, this.argosProvider, this.libreProvider, this.cloudProvider];
  private readonly cache = new RequestCache<TranslationRouterResult>();
  private readonly router = new TranslationRouter(this.providers, undefined, costGate, this.cache);

  /** Wired to the cache:clear WS message (Phase 11). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Phase 5's "Pause Translation" control — the English transcript keeps
   * flowing (SpeechManager is untouched), only routing/broadcasting the
   * translation stops for these sessions. */
  private readonly pausedSessions = new Set<string>();

  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId);
  }

  resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
  }

  isPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /** Non-blocking on purpose — must never delay the WS server coming up. */
  async initialize(): Promise<void> {
    await this.localProvider.start({});
    await this.argosProvider.start({});
    await this.libreProvider.start({ baseUrl: process.env.LIBRETRANSLATE_BASE_URL });
    await this.refreshCloudProvider();

    backendEventBus.on('transcript:produced', ({ segment, sessionId }) => {
      void this.handleTranscript(segment, sessionId);
    });
  }

  /** Re-reads the active 'translation' provider config and (re)connects the
   * cloud provider. Safe to call again after the user changes API Providers. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('translation');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud translation provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud translation provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real translate() call through the already-active cloud
   * provider, for the API Providers "Test key" button. Only meaningful for
   * the currently-active provider of this kind (only one can be active at
   * a time, per api_providers' unique-per-kind index). */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.translate({ text: 'Hello', mode: 'hinglish', sourceLang: 'en', targetLang: 'hi' });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async handleTranscript(segment: TranscriptSegment, sessionId: string): Promise<void> {
    if (!segment.text.trim()) return;
    if (this.pausedSessions.has(sessionId)) return; // transcript keeps flowing; translation is paused

    const session = sessionsRepository.get(sessionId);
    const mode = session?.mode ?? 'hinglish';
    const targetLang = mode === 'simple-english' ? 'en' : 'hi';

    try {
      const outcome = await this.router.translateWithFallback({
        text: segment.text,
        sourceLang: 'en',
        targetLang,
        mode,
      });

      const dto: TranslationResultDTO = {
        sessionId,
        originalText: segment.text,
        translatedText: outcome.result.translatedText,
        suggestedReply: outcome.result.suggestedReply,
        mode,
        sourceLang: 'en',
        targetLang,
        confidence: outcome.result.confidence,
        createdAt: new Date().toISOString(),
      };

      historyRepository.insert(dto);
      broadcast({ type: 'translation:update', sessionId, result: dto });
      broadcast({ type: 'translation:status', sessionId, providerId: outcome.providerId, status: 'ready' });

      if (!outcome.cacheHit) {
        const provider = this.providers.find((p) => p.id === outcome.providerId);
        const capabilities = provider?.getCapabilities();
        costManager.record({
          kind: 'translation',
          providerId: capabilities?.requiresApiKey ? outcome.providerId : null,
          providerLabel: capabilities?.displayName ?? outcome.providerId,
          tier: capabilities?.tier ?? 'local',
          requiresApiKey: capabilities?.requiresApiKey ?? false,
          requestType: 'translate',
          inputUnits: segment.text.length,
          outputUnits: outcome.result.translatedText.length,
          meetingSessionId: sessionId,
        });
      }
    } catch (error) {
      log.error({ err: error, sessionId }, 'translation failed');
      broadcast({ type: 'error', code: 'TRANSLATION_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'translation:status', sessionId, providerId: 'router', status: 'error' });
    }
  }
}

export const translationManager = new TranslationManager();
