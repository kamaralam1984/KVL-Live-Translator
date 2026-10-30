import type { AudioErrorCode } from '@kvl/audio';

export class AudioCaptureError extends Error {
  readonly code: AudioErrorCode;

  constructor(code: AudioErrorCode, message: string) {
    super(message);
    this.name = 'AudioCaptureError';
    this.code = code;
  }
}

/** Maps a browser MediaError/DOMException from getUserMedia/getDisplayMedia to our error codes. */
export function mapMediaError(error: unknown, context: 'microphone' | 'system-audio'): AudioCaptureError {
  const name = error instanceof DOMException ? error.name : undefined;

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new AudioCaptureError(
      context === 'microphone' ? 'MICROPHONE_PERMISSION_DENIED' : 'AUDIO_PERMISSION_REQUIRED',
      `Permission denied for ${context}`,
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new AudioCaptureError(
      context === 'microphone' ? 'AUDIO_DEVICE_DISCONNECTED' : 'SYSTEM_AUDIO_UNAVAILABLE',
      `No matching device found for ${context}`,
    );
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new AudioCaptureError('AUDIO_CAPTURE_INTERRUPTED', `Capture interrupted for ${context}`);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AudioCaptureError('AUDIO_INITIALIZATION_FAILED', `${context} initialization failed: ${message}`);
}
