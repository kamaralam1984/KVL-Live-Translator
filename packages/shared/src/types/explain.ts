export type ExplanationContextMode = 'selected' | 'last-1min' | 'last-5min' | 'current-topic';

export interface ExplanationTerm {
  term: string;
  definition: string;
}

/** Ephemeral, pre-save result of one explain:request — generating an
 * explanation does not auto-persist it (unlike Phase 6's response
 * generation); "Save" is a distinct, explicit action. */
export interface ExplanationDTO {
  sourceSentence: string;
  contextMode: ExplanationContextMode;
  simpleMeaning: string;
  whatTheyAreAsking: string;
  importantContext: string;
  terms: ExplanationTerm[];
  suggestedResponse: string;
  providerId: string;
}

export interface ExplanationHistoryDTO extends ExplanationDTO {
  id: string;
  sessionId: string;
  createdAt: string;
}
