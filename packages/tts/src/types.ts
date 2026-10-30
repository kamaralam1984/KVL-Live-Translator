import type { VoiceInfo } from '@kvl/shared';

export type { VoiceInfo };

export type TtsProviderTier = 'local' | 'cloud';
export type TtsProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface TtsRequest {
  text: string;
  voiceId?: string;
  /** 0.5-2.0, provider-clamped. */
  speed?: number;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
}

export interface TtsProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface TtsProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
  tier: TtsProviderTier;
  /** Input length this provider will accept before rejecting outright —
   * never silently truncated (see the Phase 7 plan's "long sentences and
   * technical terminology" test requirement). */
  maxTextLength: number;
}

/**
 * A backend speech-synthesis backend, local or cloud. Deliberately NOT the
 * renderer-facing playback interface (play/pause/resume/stop) — this
 * process has no speakers. synthesize() turns text into audio bytes; actual
 * playback is entirely the renderer's job (apps/desktop/src/renderer/src/tts/),
 * which is also where the Browser tier (window.speechSynthesis) lives, since
 * it doesn't exist in Node at all.
 */
export interface TtsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: TtsProviderTier;
  start(config: TtsProviderConfig): Promise<void>;
  stop(): Promise<void>;
  synthesize(request: TtsRequest): Promise<TtsResult>;
  getVoices(): Promise<VoiceInfo[]>;
  getStatus(): TtsProviderStatus;
  getCapabilities(): TtsProviderCapabilities;
}
