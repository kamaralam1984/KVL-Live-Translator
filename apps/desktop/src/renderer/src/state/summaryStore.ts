import { create } from 'zustand';
import type { MeetingSummaryDTO } from '@kvl/shared';

function randomRequestId(): string {
  return `summary-${Math.random().toString(36).slice(2, 10)}`;
}

type DraftPatch = Partial<Pick<MeetingSummaryDTO, 'executiveSummary' | 'meetingObjective' | 'keyDiscussionPoints' | 'suggestedNextSteps'>>;

interface SummaryState {
  draft: MeetingSummaryDTO | null;
  isGenerating: boolean;
  isSaving: boolean;
  lastSaved: boolean;
  lastError: string | null;
  lastRequestId: string | null;
  /** True while the pending request is a summary:get (fetch of an
   * already-saved summary) rather than summary:generate — lets
   * receiveResult mark the incoming draft as already-saved. */
  isFetch: boolean;
  /** Phase 14 renderer-observed latency: wall-clock ms between
   * summary:generate being sent and summary:result arriving — never set for
   * a summary:get fetch of an already-saved summary. */
  lastLatencyMs: number | null;

  /** Returns the new requestId — caller sends it in the WS message so the
   * result can be correlated back (stale/duplicate results are ignored). */
  startGenerate: () => string;
  /** Same correlation, for summary:get (Meeting History's "view" action) —
   * doesn't set isGenerating, since fetching an already-saved summary
   * shouldn't show a "Generating…" label. */
  startFetch: () => string;
  receiveResult: (requestId: string, result: MeetingSummaryDTO) => void;

  startSave: () => string;
  receiveSaved: (requestId: string) => void;

  startDelete: () => string;
  receiveDeleted: (requestId: string) => void;

  receiveError: (requestId: string, message: string) => void;
  setLatency: (ms: number) => void;

  /** Purely client-side, like Phase 8's updateSuggestedResponse — no WS
   * round trip until an explicit Save. */
  updateDraft: (patch: DraftPatch) => void;
  /** Loads an already-persisted summary directly (Meeting History's "view
   * this meeting" flow) — no generate step needed. */
  setDraft: (draft: MeetingSummaryDTO | null) => void;
  clear: () => void;
}

export const useSummaryStore = create<SummaryState>((set, get) => ({
  draft: null,
  isGenerating: false,
  isSaving: false,
  lastSaved: false,
  lastError: null,
  lastRequestId: null,
  isFetch: false,
  lastLatencyMs: null,

  startGenerate: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, isGenerating: true, lastError: null, lastSaved: false, isFetch: false });
    return requestId;
  },
  startFetch: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId, lastError: null, isFetch: true });
    return requestId;
  },
  receiveResult: (requestId, result) => {
    if (get().lastRequestId !== requestId) return; // stale/duplicate — ignore
    set({ draft: result, isGenerating: false, lastSaved: get().isFetch });
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

  startDelete: () => {
    const requestId = randomRequestId();
    set({ lastRequestId: requestId });
    return requestId;
  },
  receiveDeleted: (requestId) => {
    if (get().lastRequestId !== requestId) return;
    set({ draft: null, lastSaved: false });
  },

  receiveError: (requestId, message) => {
    if (get().lastRequestId !== requestId) return;
    set({ lastError: message, isGenerating: false, isSaving: false });
  },
  setLatency: (lastLatencyMs) => set({ lastLatencyMs }),

  updateDraft: (patch) => {
    const draft = get().draft;
    if (draft) set({ draft: { ...draft, ...patch } });
  },
  setDraft: (draft) => set({ draft, lastSaved: Boolean(draft) }),
  clear: () => set({ draft: null, lastError: null, lastSaved: false }),
}));
