import type { CopilotItemDTO } from './copilot';

/** The 4 fields that genuinely need LLM synthesis — no structured source
 * for these exists (unlike the other 7 summary sections, which are a live
 * query of confirmed CopilotItemDTOs, see the Phase 10 plan). */
export interface MeetingSummaryDTO {
  sessionId: string;
  executiveSummary: string;
  meetingObjective: string;
  keyDiscussionPoints: string[];
  suggestedNextSteps: string[];
  /** Live-queried confirmed facts, not stored on the summary row — always
   * current, never a stale snapshot. */
  clientRequirements: CopilotItemDTO[];
  decisions: CopilotItemDTO[];
  actionItems: CopilotItemDTO[];
  deadlines: CopilotItemDTO[];
  questions: CopilotItemDTO[];
  risks: CopilotItemDTO[];
  followUpItems: CopilotItemDTO[];
  providerId: string;
}

export interface MeetingSummaryHistoryDTO extends MeetingSummaryDTO {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingHistoryEntryDTO {
  sessionId: string;
  title?: string;
  language: string;
  startedAt: string;
  endedAt?: string;
  /** Milliseconds — undefined if the meeting never ended (still active or
   * was never properly closed). */
  durationMs?: number;
  segmentCount: number;
  actionItemCount: number;
  hasSummary: boolean;
}
