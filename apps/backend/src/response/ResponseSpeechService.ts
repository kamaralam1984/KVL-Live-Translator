import type { SpeechInputChunk } from '@kvl/speech';
import type { SpeechManager } from '../speech/SpeechManager';

/**
 * Thin wrapper around the already-running SpeechManager for Phase 6's
 * push-to-talk recording — reuses the same whisper.cpp/cloud provider
 * instances (and their auto-detect language behavior) rather than spawning
 * a second whisper.cpp process or a second cloud-STT connection. See the
 * Phase 6 plan for why this reuse is safe.
 */
export class ResponseSpeechService {
  constructor(private readonly speechManager: SpeechManager) {}

  async transcribe(chunk: SpeechInputChunk): Promise<{ text: string; languageCode?: string; providerId: string }> {
    return this.speechManager.transcribeOnce(chunk);
  }
}
