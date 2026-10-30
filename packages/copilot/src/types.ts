import type { CopilotCategory } from '@kvl/shared';

export type CopilotProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface CopilotBatchSegment {
  text: string;
  timestampMs: number;
}

export interface CopilotBatchRequest {
  /** Oldest first. */
  segments: CopilotBatchSegment[];
}

export interface CopilotExtractedItem {
  category: CopilotCategory;
  description: string;
  sourceText: string;
  /** Index into the request's segments array this was extracted from —
   * lets CopilotManager attach a real timestampMs deterministically,
   * without fuzzy-matching sourceText back against the batch. */
  segmentIndex: number;
  owner?: string;
  dueText?: string;
  confidence?: number;
}

export interface CopilotBatchResult {
  items: CopilotExtractedItem[];
}

export interface CopilotProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface CopilotProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
}

/**
 * The cloud batch-analysis backend for the 8 categories Local can't do
 * (see the Phase 9 plan — this isn't a fallback-chain interface like
 * TranslationProvider/ResponseProvider/ExplanationProvider, since Local
 * and Cloud cover different categories rather than competing).
 */
export interface CopilotProvider {
  readonly id: string;
  readonly displayName: string;
  start(config: CopilotProviderConfig): Promise<void>;
  stop(): Promise<void>;
  analyzeBatch(request: CopilotBatchRequest): Promise<CopilotBatchResult>;
  getStatus(): CopilotProviderStatus;
  getCapabilities(): CopilotProviderCapabilities;
}
