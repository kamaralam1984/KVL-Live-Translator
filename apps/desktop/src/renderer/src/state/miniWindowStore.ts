import { create } from 'zustand';
import type { MiniWindowMode, DisplayPreference } from '../../../main/miniWindowState';

interface DisplayOption {
  id: number;
  label: string;
  isPrimary: boolean;
}

interface MiniWindowUiState {
  mode: MiniWindowMode;
  /** Restored on expanding out of 'collapsed'. */
  lastNonCollapsedMode: MiniWindowMode;
  alwaysOnTop: boolean;
  opacity: number;
  interactive: boolean;
  displayPreference: DisplayPreference;
  displays: DisplayOption[];
  hydrated: boolean;

  hydrate: (state: {
    mode: MiniWindowMode;
    alwaysOnTop: boolean;
    opacity: number;
    interactive: boolean;
    displayPreference: DisplayPreference;
  }) => void;
  setDisplays: (displays: DisplayOption[]) => void;
  setMode: (mode: MiniWindowMode) => void;
  setAlwaysOnTop: (on: boolean) => void;
  setOpacity: (opacity: number) => void;
  setInteractive: (on: boolean) => void;
  setDisplayPreference: (preference: DisplayPreference) => void;
}

/** Deliberately NOT a shared/reused slice of translatorUiStore.compactMode —
 * MiniTranslator.tsx already hardcoded its own compact-ness independent of
 * that field before this phase (confirmed by reading it), so this store
 * keeps the floating window's own mode/opacity/always-on-top/interactive
 * state cleanly separate. Not localStorage-persisted either (unlike
 * translatorUiStore) — the main process is the source of truth for these
 * real OS window properties (a freshly-created BrowserWindow always starts
 * from Electron defaults regardless of a stale renderer-side value), so
 * this is hydrated fresh from window.kvlAPI.getMiniWindowState() on mount. */
export const useMiniWindowStore = create<MiniWindowUiState>((set, get) => ({
  mode: 'compact',
  lastNonCollapsedMode: 'compact',
  alwaysOnTop: false,
  opacity: 1,
  interactive: true,
  displayPreference: 'primary',
  displays: [],
  hydrated: false,

  hydrate: (state) =>
    set({
      ...state,
      lastNonCollapsedMode: state.mode === 'collapsed' ? get().lastNonCollapsedMode : state.mode,
      hydrated: true,
    }),
  setDisplays: (displays) => set({ displays }),
  setMode: (mode) => set({ mode, lastNonCollapsedMode: mode === 'collapsed' ? get().lastNonCollapsedMode : mode }),
  setAlwaysOnTop: (alwaysOnTop) => set({ alwaysOnTop }),
  setOpacity: (opacity) => set({ opacity }),
  setInteractive: (interactive) => set({ interactive }),
  setDisplayPreference: (displayPreference) => set({ displayPreference }),
}));
