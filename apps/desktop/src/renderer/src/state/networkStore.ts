import { create } from 'zustand';

interface NetworkState {
  isOnline: boolean;
  setOnline: (isOnline: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  setOnline: (isOnline) => set({ isOnline }),
}));

/** Called once near the app root — mirrors how connect()/setErrorNotifier
 * are wired at the top level. navigator.onLine reflects OS-level network
 * reachability, not whether any specific cloud provider is up — the
 * honest, low-effort signal for "cloud features are probably unreachable
 * right now" that this phase's offline-mode banner needs. */
export function installNetworkStatusListener(): () => void {
  const handleOnline = () => useNetworkStore.getState().setOnline(true);
  const handleOffline = () => useNetworkStore.getState().setOnline(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
