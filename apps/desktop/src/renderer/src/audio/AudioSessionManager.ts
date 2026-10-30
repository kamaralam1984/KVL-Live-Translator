import type { AudioFormat, CaptureMode } from '@kvl/audio';
import { EXPORT_FORMAT } from './AudioFormat';

export interface AudioSessionInfo {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  captureMode: CaptureMode;
  audioFormat: AudioFormat;
  micDeviceLabel?: string;
}

/**
 * Tracks the current capture session's audio metadata client-side. The
 * backend persists the same fields (session:start's optional captureMode/
 * audioFormat/micDeviceLabel, see packages/shared/src/ws-protocol.ts and
 * apps/backend's meeting_sessions table) — this class is just the
 * renderer-side source of truth feeding that message.
 */
export class AudioSessionManager {
  private current: AudioSessionInfo | null = null;

  start(sessionId: string, captureMode: CaptureMode, micDeviceLabel?: string): AudioSessionInfo {
    this.current = {
      sessionId,
      startedAt: Date.now(),
      captureMode,
      audioFormat: EXPORT_FORMAT,
      micDeviceLabel,
    };
    return this.current;
  }

  end(): void {
    if (this.current) this.current = { ...this.current, endedAt: Date.now() };
  }

  get session(): AudioSessionInfo | null {
    return this.current;
  }

  get durationMs(): number {
    if (!this.current) return 0;
    return (this.current.endedAt ?? Date.now()) - this.current.startedAt;
  }

  reset(): void {
    this.current = null;
  }
}
