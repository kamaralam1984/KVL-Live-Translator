import { backendEventBus } from '../events/backendEventBus';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { transcriptSegmentsRepository } from '../db/repositories/transcriptSegmentsRepository';
import { childLogger } from '../logger';

const log = childLogger('transcript-persistence');

/**
 * The real gap this phase closes: transcript segments previously only ever
 * lived in SpeechManager's in-memory TranscriptBuffer, never durably saved.
 * Subscribes to the same transcript:produced event Phase 4/6/9 already use
 * — gated by the `saveTranscript` AppSettings key, which has existed since
 * Phase 1 but was never actually enforced by anything until now.
 */
export function initTranscriptPersistence(): void {
  backendEventBus.on('transcript:produced', ({ segment, sessionId }) => {
    const settings = settingsRepository.getAll();
    const saveTranscript = settings.saveTranscript !== false; // default true, same as Settings.tsx's own default
    if (!saveTranscript) return;

    try {
      transcriptSegmentsRepository.insert(sessionId, segment);
    } catch (error) {
      log.error({ err: error, sessionId }, 'failed to persist transcript segment');
    }
  });
}
