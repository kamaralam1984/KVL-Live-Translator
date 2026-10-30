import { create } from 'zustand';
import type { VoiceInfo } from '@kvl/shared';
import type { TTSPlaybackState, TTSTierId } from '../tts/types';

interface TtsState {
  playbackState: TTSPlaybackState;
  queueLength: number;
  lastTier: TTSTierId | null;
  lastProviderId: string | null;
  voices: VoiceInfo[];
  selectedVoiceId: string | null;
  speed: number;
  volume: number;
  /** Synced from the backend `settings` blob (Settings.tsx), not localStorage
   * — this is an app-wide privacy behavior, not a per-viewer UI preference. */
  offlineOnly: boolean;
  /** Phase 14 renderer-observed latency: wall-clock ms between
   * tts:synthesize being sent and tts:audio arriving, stamped in ttsBridge.ts. */
  lastLatencyMs: number | null;

  setPlaybackState: (state: TTSPlaybackState) => void;
  setQueueLength: (n: number) => void;
  setLastSpoken: (tier: TTSTierId, providerId: string) => void;
  setVoices: (voices: VoiceInfo[]) => void;
  setSelectedVoiceId: (id: string | null) => void;
  setSpeed: (speed: number) => void;
  setVolume: (volume: number) => void;
  setOfflineOnly: (value: boolean) => void;
  setLatency: (ms: number) => void;
}

export const useTtsStore = create<TtsState>((set) => ({
  playbackState: 'idle',
  queueLength: 0,
  lastTier: null,
  lastProviderId: null,
  voices: [],
  selectedVoiceId: null,
  speed: 1,
  volume: 1,
  offlineOnly: false,
  lastLatencyMs: null,

  setPlaybackState: (playbackState) => set({ playbackState }),
  setQueueLength: (queueLength) => set({ queueLength }),
  setLastSpoken: (lastTier, lastProviderId) => set({ lastTier, lastProviderId }),
  setVoices: (voices) => set({ voices }),
  setSelectedVoiceId: (selectedVoiceId) => set({ selectedVoiceId }),
  setSpeed: (speed) => set({ speed }),
  setVolume: (volume) => set({ volume }),
  setOfflineOnly: (offlineOnly) => set({ offlineOnly }),
  setLatency: (lastLatencyMs) => set({ lastLatencyMs }),
}));
