import { create } from 'zustand';
import type { ResponseStyle } from '@kvl/shared';

function randomRequestId(): string {
  return `resp-${Math.random().toString(36).slice(2, 10)}`;
}

interface ResponseState {
  sourceText: string;
  englishText: string;
  style: ResponseStyle;
  providerId: string | null;
  isTranscribing: boolean;
  isGenerating: boolean;
  lastRequestId: string | null;
  lastError: string | null;

  setSourceText: (text: string) => void;
  setEnglishText: (text: string) => void;
  setStyle: (style: ResponseStyle) => void;

  /** Returns the new requestId — caller sends it in the WS message so the
   * result can be correlated back (stale/duplicate results are ignored). */
  startTranscribing: () => string;
  receiveTranscript: (requestId: string, text: string) => void;

  startGenerating: () => string;
  receiveResult: (requestId: string, englishText: string, providerId: string) => void;

  receiveError: (requestId: string, message: string) => void;
  clear: () => void;
}

export const useResponseStore = create<ResponseState>((set, get) => ({
  sourceText: '',
  englishText: '',
  style: 'professional',
  providerId: null,
  isTranscribing: false,
  isGenerating: false,
  lastRequestId: null,
  lastError: null,

  setSourceText: (sourceText) => set({ sourceText }),
  setEnglishText: (englishText) => set({ englishText }),
  setStyle: (style) => set({ style }),

  startTranscribing: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, isTranscribing: true, lastError: null });
    return requestId;
  },
  receiveTranscript: (requestId, text) => {
    if (get().lastRequestId !== requestId) return; // stale/duplicate — ignore
    set({ sourceText: text, isTranscribing: false });
  },

  startGenerating: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, isGenerating: true, lastError: null });
    return requestId;
  },
  receiveResult: (requestId, englishText, providerId) => {
    if (get().lastRequestId !== requestId) return;
    set({ englishText, providerId, isGenerating: false });
  },

  receiveError: (requestId, message) => {
    if (get().lastRequestId !== requestId) return;
    set({ lastError: message, isTranscribing: false, isGenerating: false });
  },

  clear: () => set({ sourceText: '', englishText: '', providerId: null, lastError: null }),
}));
