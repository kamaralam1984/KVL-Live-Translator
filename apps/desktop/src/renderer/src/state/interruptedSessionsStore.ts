import { create } from 'zustand';
import type { MeetingSession } from '@kvl/shared';

interface InterruptedSessionsState {
  sessions: MeetingSession[];
  dismissed: boolean;
  setSessions: (sessions: MeetingSession[]) => void;
  removeSession: (sessionId: string) => void;
  dismiss: () => void;
}

/** Phase 14 crash recovery: populated once at boot from session:interrupted-data,
 * not persisted — a fresh check runs on every launch rather than remembering a
 * stale dismissal across restarts. */
export const useInterruptedSessionsStore = create<InterruptedSessionsState>((set) => ({
  sessions: [],
  dismissed: false,
  setSessions: (sessions) => set({ sessions, dismissed: false }),
  removeSession: (sessionId) => set((state) => ({ sessions: state.sessions.filter((s) => s.id !== sessionId) })),
  dismiss: () => set({ dismissed: true }),
}));
