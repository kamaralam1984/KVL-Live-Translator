import { mapMediaError } from './errors';
import type { AudioCaptureError } from './errors';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Wraps microphone permission querying/requesting. System audio (getDisplayMedia)
 * has no separate pre-flight permission query in browsers — its prompt only
 * appears at capture time, so there's no equivalent query() for it here.
 */
export const AudioPermissionManager = {
  async queryMicrophonePermission(): Promise<PermissionState> {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state as PermissionState;
    } catch {
      return 'unknown';
    }
  },

  /** Requests mic permission by attempting a short-lived getUserMedia probe. */
  async requestMicrophonePermission(): Promise<{ granted: boolean; error?: AudioCaptureError }> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return { granted: true };
    } catch (error) {
      return { granted: false, error: mapMediaError(error, 'microphone') };
    }
  },
};
