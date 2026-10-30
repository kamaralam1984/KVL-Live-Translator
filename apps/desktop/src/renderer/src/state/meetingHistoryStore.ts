import { create } from 'zustand';
import type { MeetingHistoryEntryDTO } from '@kvl/shared';

interface MeetingHistoryState {
  meetings: MeetingHistoryEntryDTO[];
  setMeetings: (meetings: MeetingHistoryEntryDTO[]) => void;
  removeMeeting: (sessionId: string) => void;
}

export const useMeetingHistoryStore = create<MeetingHistoryState>((set) => ({
  meetings: [],
  setMeetings: (meetings) => set({ meetings }),
  removeMeeting: (sessionId) => set((state) => ({ meetings: state.meetings.filter((m) => m.sessionId !== sessionId) })),
}));
