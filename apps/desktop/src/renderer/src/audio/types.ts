import type { AudioErrorCode, AudioFormat, AudioLevels, AudioSourceTag, CaptureMode } from '@kvl/audio';
import type { AudioCaptureError } from './errors';

export type { AudioErrorCode, AudioFormat, AudioLevels, AudioSourceTag, CaptureMode };

export type AudioEngineState =
  | 'idle'
  | 'initializing'
  | 'requesting-permission'
  | 'ready'
  | 'capturing'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

export type VadState = 'silence' | 'speech-start' | 'speech' | 'speech-end';

export type AppPlatform = 'darwin' | 'linux' | 'win32' | 'unknown';

/** Payload for the `audio.chunk.ready` event — the Phase 3 STT contract. */
export interface AudioChunkReadyPayload {
  sessionId: string;
  chunkId: string;
  source: AudioSourceTag;
  timestamp: number;
  duration: number;
  format: AudioFormat;
  speechDetected: boolean;
  sequenceNumber: number;
  audioData: Float32Array;
}

/** A single fixed-duration frame as produced by the capture worklet. */
export interface AudioFrame {
  timestamp: number;
  samples: Float32Array;
  rms: number;
}

export interface AudioEngineEvents {
  'chunk:ready': AudioChunkReadyPayload;
  'levels:update': { source: AudioSourceTag; levels: AudioLevels };
  'vad:state': { source: AudioSourceTag; state: VadState };
  'device:disconnected': { deviceId: string; label: string };
  /** Phase 14: fired while a bounded same-device auto-retry is in progress,
   * before the terminal 'error' event — lets the UI show "Reconnecting..."
   * instead of jumping straight to a manual-prompt error state. */
  'device:reconnecting': { label: string; attempt: number; delayMs: number };
  'device:reconnected': { deviceId: string; label: string };
  'buffer:overflow': { source: AudioSourceTag; droppedFrames: number };
  error: { error: AudioCaptureError };
}
