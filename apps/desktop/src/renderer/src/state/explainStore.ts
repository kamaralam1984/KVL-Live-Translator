import { create } from 'zustand';
import type { ExplanationContextMode, ExplanationDTO, TranscriptSegment } from '@kvl/shared';

function randomRequestId(): string {
  return `explain-${Math.random().toString(36).slice(2, 10)}`;
}

interface ExplainState {
  selectedSegment: TranscriptSegment | null;
  contextMode: ExplanationContextMode;
  draft: ExplanationDTO | null;
  isExplaining: boolean;
  isSaving: boolean;
  lastSaved: boolean;
  lastError: string | null;
  lastRequestId: string | null;
  /** Phase 14 renderer-observed latency: wall-clock ms between
   * explain:request being sent and explain:result arriving. */
  lastLatencyMs: number | null;

  select: (segment: TranscriptSegment) => void;
  setContextMode: (mode: ExplanationContextMode) => void;

  /** Returns the new requestId — caller sends it in the WS message so the
   * result can be correlated back (stale/duplicate results are ignored). */
  startExplain: () => string;
  receiveResult: (requestId: string, result: ExplanationDTO) => void;

  startSave: () => string;
  receiveSaved: (requestId: string) => void;

  receiveError: (requestId: string, message: string) => void;
  updateSuggestedResponse: (text: string) => void;
  setLatency: (ms: number) => void;
  clear: () => void;
}

export const useExplainStore = create<ExplainState>((set, get) => ({
  selectedSegment: null,
  contextMode: 'selected',
  draft: null,
  isExplaining: false,
  isSaving: false,
  lastSaved: false,
  lastError: null,
  lastRequestId: null,
  lastLatencyMs: null,

  select: (segment) => set({ selectedSegment: segment, draft: null, lastError: null, lastSaved: false }),
  setContextMode: (contextMode) => set({ contextMode }),

  startExplain: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, isExplaining: true, lastError: null, lastSaved: false });
    return requestId;
  },
  receiveResult: (requestId, result) => {
    if (get().lastRequestId !== requestId) return; // stale/duplicate — ignore
    set({ draft: result, isExplaining: false });
  },

  startSave: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, isSaving: true });
    return requestId;
  },
  receiveSaved: (requestId) => {
    if (get().lastRequestId !== requestId) return;
    set({ isSaving: false, lastSaved: true });
  },

  receiveError: (requestId, message) => {
    if (get().lastRequestId !== requestId) return;
    set({ lastError: message, isExplaining: false, isSaving: false });
  },

  updateSuggestedResponse: (suggestedResponse) => {
    const draft = get().draft;
    if (draft) set({ draft: { ...draft, suggestedResponse } });
  },
  setLatency: (lastLatencyMs) => set({ lastLatencyMs }),

  clear: () => set({ selectedSegment: null, draft: null, lastError: null, lastSaved: false }),
}));
