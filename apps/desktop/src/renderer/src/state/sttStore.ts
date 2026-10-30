import { create } from 'zustand';

export type SttStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

interface SttStoreState {
  providerId: string | null;
  status: SttStatus;
  setStatus: (providerId: string, status: SttStatus) => void;
}

export const useSttStore = create<SttStoreState>((set) => ({
  providerId: null,
  status: 'unavailable',
  setStatus: (providerId, status) => set({ providerId, status }),
}));
