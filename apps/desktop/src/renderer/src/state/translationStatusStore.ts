import { create } from 'zustand';

export type TranslationStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

interface TranslationStatusState {
  providerId: string | null;
  status: TranslationStatus;
  /** Wall-clock ms between transcript:update and translation:update arriving
   * for the same session — see wsClient.ts's latency-stamping comment for
   * the "one chunk in flight per session at a time" assumption this relies on. */
  lastLatencyMs: number | null;
  setStatus: (providerId: string, status: TranslationStatus) => void;
  setLatency: (ms: number) => void;
}

export const useTranslationStatusStore = create<TranslationStatusState>((set) => ({
  providerId: null,
  status: 'unavailable',
  lastLatencyMs: null,
  setStatus: (providerId, status) => set({ providerId, status }),
  setLatency: (lastLatencyMs) => set({ lastLatencyMs }),
}));
