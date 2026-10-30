/** Capture mode a user selects on the Meeting Translator / Diagnostics screens. */
export type CaptureMode = 'system' | 'microphone' | 'both';

/** Which captured stream a chunk/level/VAD event came from. */
export type AudioSourceTag = 'microphone' | 'system' | 'mixed';

/** Canonical internal audio format — set once per session, avoid unnecessary resampling. */
export interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  encoding: 'pcm-s16le' | 'pcm-f32';
}

/** Lightweight level info for UI meters — never carries raw audio samples. */
export interface AudioLevels {
  rms: number;
  peak: number;
  normalized: number;
  silent: boolean;
}

export type AudioErrorCode =
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'SYSTEM_AUDIO_UNAVAILABLE'
  | 'AUDIO_DEVICE_DISCONNECTED'
  | 'AUDIO_INITIALIZATION_FAILED'
  | 'AUDIO_BUFFER_OVERFLOW'
  | 'AUDIO_CAPTURE_INTERRUPTED'
  | 'UNSUPPORTED_AUDIO_FORMAT'
  | 'AUDIO_PERMISSION_REQUIRED';
