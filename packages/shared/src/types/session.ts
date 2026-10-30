import type { TranslationMode } from './translation';
import type { AudioFormat, CaptureMode } from './audio';

export interface MeetingSession {
  id: string;
  title?: string;
  mode: TranslationMode;
  startedAt: string;
  endedAt?: string;
  /** Phase 2 additions — optional so pre-Phase-2 session objects stay valid. */
  captureMode?: CaptureMode;
  audioFormat?: AudioFormat;
  micDeviceLabel?: string;
}
