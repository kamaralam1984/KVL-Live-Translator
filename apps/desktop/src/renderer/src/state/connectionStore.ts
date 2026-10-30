import { create } from 'zustand';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStoreState {
  status: ConnectionState;
  lastError?: string;
  setStatus: (status: ConnectionState, lastError?: string) => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  status: 'connecting',
  setStatus: (status, lastError) => set({ status, lastError }),
}));
