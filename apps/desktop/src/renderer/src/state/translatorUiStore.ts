import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontSize = 'sm' | 'md' | 'lg' | 'xl';

export const FONT_SIZE_PX: Record<FontSize, string> = {
  sm: '12px',
  md: '14px',
  lg: '17px',
  xl: '21px',
};

interface TranslatorUiState {
  fontSize: FontSize;
  autoScroll: boolean;
  compactMode: boolean;
  /** In compact mode, only one panel shows at a time — this picks which. */
  showOriginal: boolean;
  translationPaused: boolean;
  /** Phase 12: independent show/hide for the Suggested Reply card, distinct
   * from compactMode (which already hides it as part of a denser layout). */
  showResponsePanel: boolean;

  setFontSize: (size: FontSize) => void;
  setAutoScroll: (on: boolean) => void;
  setCompactMode: (on: boolean) => void;
  toggleShowOriginal: () => void;
  setTranslationPaused: (paused: boolean) => void;
  setShowResponsePanel: (on: boolean) => void;
  toggleShowResponsePanel: () => void;
}

/** Per-viewer display preferences, not meeting data — persisted the same
 * way themeStore.ts persists dark/light preference (localStorage, no
 * backend round trip). */
export const useTranslatorUiStore = create<TranslatorUiState>()(
  persist(
    (set) => ({
      fontSize: 'md',
      autoScroll: true,
      compactMode: false,
      showOriginal: true,
      translationPaused: false,
      showResponsePanel: true,

      setFontSize: (fontSize) => set({ fontSize }),
      setAutoScroll: (autoScroll) => set({ autoScroll }),
      setCompactMode: (compactMode) => set({ compactMode }),
      toggleShowOriginal: () => set((state) => ({ showOriginal: !state.showOriginal })),
      setTranslationPaused: (translationPaused) => set({ translationPaused }),
      setShowResponsePanel: (showResponsePanel) => set({ showResponsePanel }),
      toggleShowResponsePanel: () => set((state) => ({ showResponsePanel: !state.showResponsePanel })),
    }),
    { name: 'kvl-translator-ui' },
  ),
);
