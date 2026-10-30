import { create } from 'zustand';
import type { TranscriptSegment, TranslationMode, TranslationResultDTO } from '@kvl/shared';

export type DeviceStatus = 'idle' | 'listening' | 'error';

/** Phase 14: the full history is already durably persisted (transcript_segments/
 * translation_history since Phase 10) — only the LIVE scrolling view needs
 * bounding. Without this, a 2-4 hour meeting grows these arrays unbounded,
 * with `[...array, item]` making every single append an O(n) copy (O(n^2)
 * total over a long meeting) — a real long-meeting stability risk. Pure and
 * exported so it's directly unit-testable without a DOM. */
export const MAX_LIVE_SEGMENTS = 500;

export function pushBounded<T>(array: T[], item: T, max: number = MAX_LIVE_SEGMENTS): T[] {
  const next = [...array, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

interface MeetingState {
  sessionId: string | null;
  mode: TranslationMode;
  isActive: boolean;
  transcript: TranscriptSegment[];
  /** Full scrolling feed for the "HINDI / HINGLISH" live panel. */
  translations: TranslationResultDTO[];
  /** Most recent result — convenience for the Suggested Reply panel. */
  latestTranslation: TranslationResultDTO | null;
  micStatus: DeviceStatus;
  speakerStatus: DeviceStatus;

  setMode: (mode: TranslationMode) => void;
  sessionStarted: (sessionId: string) => void;
  sessionEnded: () => void;
  appendTranscript: (segment: TranscriptSegment) => void;
  appendTranslation: (result: TranslationResultDTO) => void;
  clearTranscript: () => void;
  setMicStatus: (status: DeviceStatus) => void;
  setSpeakerStatus: (status: DeviceStatus) => void;
}

export const useMeetingStore = create<MeetingState>((set) => ({
  sessionId: null,
  mode: 'hinglish',
  isActive: false,
  transcript: [],
  translations: [],
  latestTranslation: null,
  micStatus: 'idle',
  speakerStatus: 'idle',

  setMode: (mode) => set({ mode }),
  sessionStarted: (sessionId) => set({ sessionId, isActive: true, transcript: [], translations: [], latestTranslation: null }),
  sessionEnded: () => set({ isActive: false, micStatus: 'idle', speakerStatus: 'idle' }),
  appendTranscript: (segment) => set((state) => ({ transcript: pushBounded(state.transcript, segment) })),
  appendTranslation: (result) => set((state) => ({ translations: pushBounded(state.translations, result), latestTranslation: result })),
  /** Phase 5's "Clear Transcript" — clears the current live view only, never
   * touches persisted history (Settings' "Delete Session Data" covers that). */
  clearTranscript: () => set({ transcript: [], translations: [], latestTranslation: null }),
  setMicStatus: (status) => set({ micStatus: status }),
  setSpeakerStatus: (status) => set({ speakerStatus: status }),
}));
