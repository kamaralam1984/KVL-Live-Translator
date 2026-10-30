import type { TranscriptSegment } from '@kvl/shared';
import type { SpeechInputChunk } from '@kvl/speech';
import { SpeechProviderRouter } from './SpeechProviderRouter';
import { TranscriptBuffer } from './TranscriptBuffer';
import { LocalWhisperProvider } from './providers/LocalWhisperProvider';
import { CloudSpeechProvider } from './providers/CloudSpeechProvider';
import { requestDecryptedKey } from './keyRelay';
import { providersRepository } from '../db/repositories/providersRepository';
import { broadcast } from '../ws/connectionRegistry';
import { backendEventBus } from '../events/backendEventBus';
import { costManager } from '../cost/CostManager';
import { costGate } from '../cost/CostGate';
import { childLogger } from '../logger';

const log = childLogger('speech-manager');

/**
 * Orchestrates Phase 3's STT pipeline: owns the local + cloud providers and
 * the router between them, turns each incoming audio:chunk into a
 * TranscriptSegment via TranscriptBuffer, and broadcasts the result over
 * the existing transcript:update message the UI already renders.
 */
export class SpeechManager {
  private readonly localProvider = new LocalWhisperProvider();
  private readonly cloudProvider = new CloudSpeechProvider();
  private readonly providers = [this.localProvider, this.cloudProvider];
  private readonly router = new SpeechProviderRouter(this.providers, costGate);
  private readonly buffer = new TranscriptBuffer();

  private recordUsage(providerId: string, audioSeconds: number, meetingSessionId: string | null): void {
    const provider = this.providers.find((p) => p.id === providerId);
    const capabilities = provider?.getCapabilities();
    costManager.record({
      kind: 'stt',
      providerId: capabilities?.requiresApiKey ? providerId : null,
      providerLabel: capabilities?.displayName ?? providerId,
      tier: capabilities?.requiresApiKey ? 'paid' : 'local',
      requiresApiKey: capabilities?.requiresApiKey ?? false,
      requestType: 'transcribe',
      audioSeconds,
      meetingSessionId,
    });
  }

  /** Non-blocking on purpose — must never delay the WS server coming up. */
  async initialize(): Promise<void> {
    await this.localProvider.start({});
    await this.refreshCloudProvider();
  }

  /** Re-reads the active 'stt' provider config and (re)connects the cloud
   * provider. Safe to call again after the user changes API Providers. */
  async refreshCloudProvider(): Promise<void> {
    const active = providersRepository.getActiveByKind('stt');
    if (!active || !active.hasApiKey) {
      await this.cloudProvider.stop();
      return;
    }

    try {
      const apiKey = await requestDecryptedKey(active.id);
      await this.cloudProvider.start({ apiKey, baseUrl: active.baseUrl, model: active.model });
      log.info({ providerId: active.id }, 'cloud STT provider ready');
    } catch (error) {
      log.warn({ err: error, providerId: active.id }, 'could not activate cloud STT provider');
      await this.cloudProvider.stop();
    }
  }

  /** A minimal real transcribe() call for "Test key" — CloudSpeechProvider's
   * start() never validates the key against the real API (it just stores
   * it), so a genuine authenticated round trip needs a real transcribe()
   * call. Content doesn't matter (a short silent PCM16 buffer) — an invalid
   * key still fails with a real 401 from the API either way. */
  async testCloudProvider(): Promise<{ ok: boolean; message?: string }> {
    if (!this.cloudProvider.getCapabilities().available) return { ok: false, message: 'Not the active provider for this kind, or no key configured.' };
    try {
      const silence = Buffer.alloc(16_000 * 2); // 1s of 16kHz PCM16 silence
      await this.cloudProvider.transcribe({
        sessionId: 'test-key-probe',
        chunkId: 'test-key-probe',
        sequenceNumber: 0,
        timestampMs: 0,
        durationMs: 1000,
        sampleRateHz: 16_000,
        channelCount: 1,
        audio: silence,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async handleChunk(chunk: SpeechInputChunk, sessionId: string): Promise<void> {
    try {
      const outcome = await this.router.transcribeWithFallback(chunk);
      if (!outcome.result.text) return; // nothing worth emitting

      const segment: TranscriptSegment = {
        id: chunk.chunkId,
        sessionId,
        text: outcome.result.text,
        isFinal: outcome.result.isFinal,
        startMs: chunk.timestampMs,
        endMs: chunk.timestampMs + chunk.durationMs,
        languageCode: outcome.result.languageCode,
        confidence: outcome.result.confidence,
      };

      this.buffer.insert(segment);
      broadcast({ type: 'transcript:update', sessionId, segment });
      broadcast({ type: 'stt:status', sessionId, providerId: outcome.providerId, status: 'ready' });
      backendEventBus.emit('transcript:produced', { segment, sessionId });
      this.recordUsage(outcome.providerId, chunk.durationMs / 1000, sessionId);
    } catch (error) {
      log.error({ err: error, sessionId, chunkId: chunk.chunkId }, 'speech transcription failed');
      broadcast({ type: 'error', code: 'STT_FAILED', message: error instanceof Error ? error.message : String(error) });
      broadcast({ type: 'stt:status', sessionId, providerId: 'router', status: 'error' });
    }
  }

  /** One-shot transcription outside the continuous meeting-transcript flow —
   * used by Phase 6's push-to-talk response recorder. Skips the
   * TranscriptBuffer/broadcast('transcript:update')/transcript:produced
   * side effects, which only make sense for the meeting-capture path;
   * routes through the same already-initialized local/cloud providers
   * (never hardcoded to English, see packages/speech/src/types.ts). */
  async transcribeOnce(chunk: SpeechInputChunk): Promise<{ text: string; languageCode?: string; providerId: string }> {
    const outcome = await this.router.transcribeWithFallback(chunk);
    this.recordUsage(outcome.providerId, chunk.durationMs / 1000, null); // My Response push-to-talk — not tied to a meeting session
    return { text: outcome.result.text, languageCode: outcome.result.languageCode, providerId: outcome.providerId };
  }

  getTranscript(sessionId: string): TranscriptSegment[] {
    return this.buffer.getSegments(sessionId);
  }

  clearSession(sessionId: string): void {
    this.buffer.clearSession(sessionId);
  }
}

export const speechManager = new SpeechManager();
