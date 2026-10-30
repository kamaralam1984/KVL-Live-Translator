import { create } from 'zustand';

export type ResponseStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

interface ResponseStatusState {
  providerId: string | null;
  status: ResponseStatus;
  /** Phase 14 renderer-observed latency: wall-clock ms between
   * response:generate being sent and response:result arriving — same
   * pattern as translationStatusStore's lastLatencyMs. */
  lastLatencyMs: number | null;
  setStatus: (providerId: string, status: ResponseStatus) => void;
  setLatency: (ms: number) => void;
}

export const useResponseStatusStore = create<ResponseStatusState>((set) => ({
  providerId: null,
  status: 'unavailable',
  lastLatencyMs: null,
  setStatus: (providerId, status) => set({ providerId, status }),
  setLatency: (lastLatencyMs) => set({ lastLatencyMs }),
}));
