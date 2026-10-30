export type SummaryProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface SummaryRequest {
  /** The final meeting transcript, already truncated to a bounded size by
   * the caller if needed (see CloudSummaryProvider's MAX_TRANSCRIPT_CHARS)
   * — this interface doesn't know or care about that policy. */
  transcriptText: string;
}

export interface SummaryResult {
  executiveSummary: string;
  meetingObjective: string;
  keyDiscussionPoints: string[];
  suggestedNextSteps: string[];
}

export interface SummaryProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface SummaryProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
}

/**
 * Synthesizes the 4 prose fields no structured source exists for. There is
 * deliberately no "local" implementation of this interface (see the Phase
 * 10 plan) — the other 7 summary sections are a live DB query, not
 * something this interface models at all.
 */
export interface SummaryProvider {
  readonly id: string;
  readonly displayName: string;
  start(config: SummaryProviderConfig): Promise<void>;
  stop(): Promise<void>;
  synthesize(request: SummaryRequest): Promise<SummaryResult>;
  getStatus(): SummaryProviderStatus;
  getCapabilities(): SummaryProviderCapabilities;
}
