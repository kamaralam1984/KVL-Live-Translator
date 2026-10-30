import type { AudioErrorCode, AudioFormat, AudioLevels, AudioSourceTag, CaptureMode } from '@kvl/shared';

export type { AudioErrorCode, AudioFormat, AudioLevels, AudioSourceTag, CaptureMode };

export type AudioSourceKind = 'microphone' | 'system-audio' | 'file';

export interface AudioCaptureSource {
  id: string;
  label: string;
  kind: AudioSourceKind;
}

export interface AudioChunk {
  sourceId: string;
  timestampMs: number;
  sampleRateHz: number;
  channelCount: number;
  /** Raw PCM16LE, little-endian, interleaved. */
  data: Buffer;
  /** Phase 2+ fields — optional so any earlier minimal chunk construction stays valid. */
  id?: string;
  sessionId?: string;
  sequenceNumber?: number;
  durationMs?: number;
  speechDetected?: boolean;
}

/**
 * Backend-side abstraction over "a stream of PCM audio from somewhere."
 * Phase 2 implementations may either relay audio the renderer captured via
 * getUserMedia/desktopCapturer and forwarded over the WS binary channel, or
 * capture directly in the backend process for non-Electron/headless use.
 * Both must satisfy this same interface so sessionManager never needs to
 * know which.
 */
export interface AudioCaptureAdapter {
  listSources(): Promise<AudioCaptureSource[]>;
  start(sourceId: string, onChunk: (chunk: AudioChunk) => void): Promise<void>;
  stop(sourceId: string): Promise<void>;
  isCapturing(sourceId: string): boolean;
}
