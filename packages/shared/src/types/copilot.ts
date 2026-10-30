/** Questions/Deadlines are real-time local detections; the other 8 need a
 * cloud LLM batch analysis (see the Phase 9 plan — Local and Cloud aren't a
 * fallback chain here, they cover different categories). */
export type CopilotCategory =
  | 'question'
  | 'decision'
  | 'action-item'
  | 'deadline'
  | 'requirement'
  | 'objection'
  | 'pricing-discussion'
  | 'technical-requirement'
  | 'follow-up'
  | 'client-request';

export type CopilotItemStatus = 'new' | 'confirmed' | 'completed';

export interface CopilotItemDTO {
  id: string;
  sessionId: string;
  category: CopilotCategory;
  description: string;
  /** Verbatim quote from the transcript this was extracted from. */
  sourceText: string;
  timestampMs: number;
  confidence: number;
  /** Only ever set if clearly stated in the transcript — never guessed. */
  owner?: string;
  /** Free text, not a parsed date — "Friday", "tomorrow", "EOD" etc. */
  dueText?: string;
  status: CopilotItemStatus;
  providerId: string;
  createdAt: string;
}
