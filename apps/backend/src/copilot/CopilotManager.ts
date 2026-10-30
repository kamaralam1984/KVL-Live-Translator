import type { TranscriptSegment } from '@kvl/shared';
import { CopilotBatcher, type BufferedSegment, type FlushBatch } from './CopilotBatcher';
import { detectLocalItems, scoreSignal } from './EventDetector';
import { CloudCopilotProvider } from './providers/CloudCopilotProvider';
import { requestDecryptedKey } from '../speech/keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { copilotItemsRepository } from '../db/repositories/copilotItemsRepository';
import { backendEventBus } from '../events/backendEventBus';
import { broadcast } from '../ws/connectionRegistry';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { childLogger } from '../logger';

const log = childLogger('copilot-manager');
const TIMEOUT_CHECK_INTERVAL_MS = 5_000;
const LOCAL_PROVIDER_ID = 'local-copilot';

/**
 * Orchestrates the always-on detection pipeline: subscribes to
 * transcript:produced (same hook Phase 4's TranslationManager uses — its
 * own doc comment already anticipated this), runs the free local detector
 * on every segment, and feeds CopilotBatcher toward occasional cloud batch
 * calls. Deliberately does NOT own the confirm/edit/delete/complete CRUD
 * actions — those are simple repository + broadcast calls handled directly
 * in protocolHandlers.ts, same convention as history:list/history:clear.
 */
export class CopilotManager {
  private readonly batcher = new CopilotBatcher();
  private readonly cloudProvider = new CloudCopilotProvider();

  async initialize(): Promise<void> {
    await this.refreshCloudProvider();

    backendEventBus.on('transcript:produced', ({ segment, sessionId }) => {
      this.handleSegment(sessionId, segment);
    });

    setInterval(() => {
      for (const sessionId of this.batcher.activeSessionIds()) {
        const batch = this.batcher.checkTimeout(sessionId, Date.now());
        if (batch) void this.flushBatch(sessionId, batch);
      }
    }, TIMEOUT_CHECK_INTERVAL_MS);
  }

  /** Falls back to the active 'response' provider's key if no dedicated
   * 'copilot' provider is configured — same one-hop precedent as Phase 6/8. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('copilot') ?? providersRepository.getActiveByKind('response');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud copilot provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud copilot provider');
      await this.cloudProvider.stop();
    }
  }

  /** One minimal real analyzeBatch() call through the already-active cloud
   * provider, for the API Providers "Test key" button. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      await this.cloudProvider.analyzeBatch({ segments: [{ text: 'This is a connection test.', timestampMs: 0 }] });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private handleSegment(sessionId: string, segment: TranscriptSegment): void {
    if (!segment.text.trim()) return;

    for (const local of detectLocalItems(segment.text)) {
      const item = copilotItemsRepository.insert({
        sessionId,
        category: local.category,
        description: local.description,
        sourceText: local.sourceText,
        timestampMs: segment.startMs,
        confidence: local.confidence,
        dueText: local.dueText,
        providerId: LOCAL_PROVIDER_ID,
        createdAt: new Date().toISOString(),
      });
      broadcast({ type: 'copilot:item', item });
    }

    const signal = scoreSignal(segment.text);
    const bufferedSegment: BufferedSegment = { text: segment.text, timestampMs: segment.startMs, signalScore: signal?.score ?? 0 };
    const batch = this.batcher.addSegment(sessionId, bufferedSegment, Date.now());
    if (batch) void this.flushBatch(sessionId, batch);
  }

  private async flushBatch(sessionId: string, batch: FlushBatch): Promise<void> {
    if (!this.cloudProvider.getCapabilities().available) return; // no key configured — batch is simply dropped, no error
    // Cost-mode/budget/local-only blocked — same "honest local-only, never
    // silently sending to cloud" degrade every other pipeline uses; local
    // detection (Questions/Deadlines, above in handleSegment) still ran.
    if (!costGate.isPaidTierAllowed()) return;

    try {
      const batchText = batch.segments.map((s) => s.text).join(' ');
      const result = await this.cloudProvider.analyzeBatch({ segments: batch.segments.map((s) => ({ text: s.text, timestampMs: s.timestampMs })) });

      for (const extracted of result.items) {
        const originSegment = batch.segments[extracted.segmentIndex] ?? batch.segments[batch.segments.length - 1];
        const item = copilotItemsRepository.insert({
          sessionId,
          category: extracted.category,
          description: extracted.description,
          sourceText: extracted.sourceText,
          timestampMs: originSegment.timestampMs,
          confidence: extracted.confidence ?? 0.8,
          owner: extracted.owner,
          dueText: extracted.dueText,
          providerId: this.cloudProvider.id,
          createdAt: new Date().toISOString(),
        });
        broadcast({ type: 'copilot:item', item });
      }
      broadcast({ type: 'copilot:status', providerId: this.cloudProvider.id, status: 'ready' });
      costManager.record({
        kind: 'copilot',
        providerId: this.cloudProvider.id,
        providerLabel: this.cloudProvider.getCapabilities().displayName,
        tier: 'cloud',
        requiresApiKey: true,
        requestType: 'detect',
        inputUnits: batchText.length,
        meetingSessionId: sessionId,
      });
    } catch (error) {
      log.error({ err: error, sessionId, reason: batch.reason }, 'copilot batch analysis failed');
      broadcast({ type: 'copilot:status', providerId: this.cloudProvider.id, status: 'error' });
    }
  }

  endSession(sessionId: string): void {
    this.batcher.endSession(sessionId);
  }

  getBufferedCount(sessionId: string): number {
    return this.batcher.getBufferedCount(sessionId);
  }
}

export const copilotManager = new CopilotManager();
