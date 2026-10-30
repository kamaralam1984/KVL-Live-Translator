export type SpeechProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface SpeechProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  streaming: boolean;
  /** True for providers that never leave the machine (e.g. a local whisper.cpp model). */
  offline: boolean;
  /** e.g. ['auto'] when the provider auto-detects language. */
  supportedLanguages: string[];
  requiresApiKey: boolean;
}

export interface SpeechInputChunk {
  sessionId: string;
  chunkId: string;
  sequenceNumber: number;
  timestampMs: number;
  durationMs: number;
  sampleRateHz: number;
  channelCount: number;
  /** Raw PCM16LE mono. */
  audio: Buffer;
}

export interface SpeechTranscriptionResult {
  text: string;
  /** Omit (or 'auto') to let the provider auto-detect — never hardcode 'en'. */
  languageCode?: string;
  confidence?: number;
  isFinal: boolean;
}

export interface SpeechProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Omit for auto-detect. */
  languageCode?: string;
}

/**
 * A speech-to-text backend, local or cloud. Phase 2's AudioChunkProcessor
 * already segments audio into complete, VAD-bounded speech chunks, so
 * transcribe() operates on one bounded chunk at a time rather than a
 * continuous stream — this fits both a whisper.cpp CLI invocation and a
 * cloud REST transcription endpoint without inventing a streaming protocol.
 */
export interface SpeechProvider {
  readonly id: string;
  readonly displayName: string;
  start(config: SpeechProviderConfig): Promise<void>;
  stop(): Promise<void>;
  transcribe(chunk: SpeechInputChunk): Promise<SpeechTranscriptionResult>;
  getStatus(): SpeechProviderStatus;
  getCapabilities(): SpeechProviderCapabilities;
}
