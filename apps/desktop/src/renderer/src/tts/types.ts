import type { VoiceInfo } from '@kvl/shared';

export type TTSTierId = 'local' | 'browser' | 'cloud';
export type TTSPlaybackState = 'idle' | 'playing' | 'paused';

export interface TTSCapabilities {
  tier: TTSTierId;
  displayName: string;
  available: boolean;
}

export interface TTSSynthesizeOptions {
  voiceId?: string;
  speed?: number;
  volume?: number;
}

/**
 * Renderer-facing playback interface — deliberately NOT the same shape as
 * the backend's TtsProvider (packages/tts/src/types.ts), which only
 * synthesizes (no speakers in Node). This is the interface the phase spec
 * asks for directly: synthesize() prepares AND begins playback (the two are
 * inseparable for the Browser tier's Web Speech API), returning once
 * playback has started; play/pause/resume/stop control the currently
 * active utterance.
 */
export interface TTSProvider {
  readonly tier: TTSTierId;
  readonly displayName: string;
  synthesize(text: string, options?: TTSSynthesizeOptions): Promise<void>;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  getVoices(): Promise<VoiceInfo[]>;
  getCapabilities(): TTSCapabilities;
  onEnded(callback: () => void): void;
}
