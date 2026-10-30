import type { ExplanationContextMode, ExplanationDTO } from '@kvl/shared';
import { ExplanationRouter } from './ExplanationRouter';
import { resolveContextWindow } from './contextWindow';
import { LocalExplanationProvider } from './providers/LocalExplanationProvider';
import { CloudExplanationProvider } from './providers/CloudExplanationProvider';
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { explanationHistoryRepository } from '../db/repositories/explanationHistoryRepository';
import { speechManager } from '../speech/SpeechManager';
import { broadcast } from '../ws/connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { childLogger } from '../logger';

const log = childLogger('explanation-manager');

/**
 * Orchestrates Phase 8's "What does this mean?" pipeline — request/response
 * driven like ResponseManager (Phase 6), not an event-bus subscription.
 * Resolves the context window from the backend's own TranscriptBuffer
 * (speechManager.getTranscript) rather than trusting a copy sent by the
 * client.
 */
export class ExplanationManager {
  private readonly localProvider = new LocalExplanationProvider();
  private readonly cloudProvider = new CloudExplanationProvider();
  private readonly providers = [this.localProvider, this.cloudProvider];
  private readonly router = new ExplanationRouter(this.providers, undefined, costGate);

  async initialize(): Promise<void> {
    await this.localProvider.start({});
    await this.refreshCloudProvider();
  }

  /** Falls back to the active 'response' provider's key if no dedicated
   * 'explanation' provider is configured — same underlying LLM account
   * doing double duty by default, same precedent as Phase 6's
   * response->translation fallback. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('explanation') ?? providersRepository.getActiveByKind('response');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud explanation provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud explanation provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real explain() call through the already-active cloud
   * provider, for the API Providers "Test key" button. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.explain({ sentence: 'This is a connection test.', contextSegments: [] });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async explain(requestId: string, sessionId: string, segmentId: string, contextMode: ExplanationContextMode): Promise<void> {
    try {
      const allSegments = speechManager.getTranscript(sessionId);
      const contextSegments = resolveContextWindow(allSegments, segmentId, contextMode);
      const target = contextSegments[contextSegments.length - 1];

      const outcome = await this.router.explainWithFallback({
        sentence: target.text,
        contextSegments: contextSegments.map((s) => s.text),
      });

      const dto: ExplanationDTO = {
        sourceSentence: target.text,
        contextMode,
        simpleMeaning: outcome.result.simpleMeaning,
        whatTheyAreAsking: outcome.result.whatTheyAreAsking,
        importantContext: outcome.result.importantContext,
        terms: outcome.result.terms,
        suggestedResponse: outcome.result.suggestedResponse,
        providerId: outcome.providerId,
      };

      broadcast({ type: 'explain:result', requestId, result: dto });
      broadcast({ type: 'explain:status', providerId: outcome.providerId, status: 'ready' });

      const provider = this.providers.find((p) => p.id === outcome.providerId);
      const capabilities = provider?.getCapabilities();
      costManager.record({
        kind: 'explanation',
        providerId: capabilities?.requiresApiKey ? outcome.providerId : null,
        providerLabel: capabilities?.displayName ?? outcome.providerId,
        tier: capabilities?.tier ?? 'local',
        requiresApiKey: capabilities?.requiresApiKey ?? false,
        requestType: 'explain',
        inputUnits: target.text.length + contextSegments.reduce((sum, s) => sum + s.text.length, 0),
        meetingSessionId: sessionId,
      });
    } catch (error) {
      log.error({ err: error, requestId, sessionId, segmentId }, 'explanation failed');
      broadcast({ type: 'explain:error', requestId, code: 'EXPLAIN_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'explain:status', providerId: 'router', status: 'error' });
    }
  }

  save(requestId: string, sessionId: string, draft: ExplanationDTO): void {
    try {
      const entry = explanationHistoryRepository.insert({
        sessionId,
        sourceSentence: draft.sourceSentence,
        contextMode: draft.contextMode,
        simpleMeaning: draft.simpleMeaning,
        whatTheyAreAsking: draft.whatTheyAreAsking,
        importantContext: draft.importantContext,
        terms: draft.terms,
        suggestedResponse: draft.suggestedResponse,
        providerId: draft.providerId,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'explain:saved', requestId, entry });
    } catch (error) {
      log.error({ err: error, requestId, sessionId }, 'saving explanation failed');
      broadcast({ type: 'explain:error', requestId, code: 'EXPLAIN_SAVE_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

export const explanationManager = new ExplanationManager();
