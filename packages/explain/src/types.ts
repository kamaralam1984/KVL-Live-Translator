import type { ExplanationTerm } from '@kvl/shared';

export type ExplanationProviderTier = 'local' | 'cloud';
export type ExplanationProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface ExplanationRequest {
  /** The selected transcript sentence. */
  sentence: string;
  /** Plain text of the resolved context window (may equal [sentence] for
   * 'selected' mode) — oldest first. */
  contextSegments: string[];
}

export interface ExplanationResult {
  simpleMeaning: string;
  whatTheyAreAsking: string;
  importantContext: string;
  terms: ExplanationTerm[];
  suggestedResponse: string;
  /** Fraction-of-job-done signal, same low-confidence-continues convention
   * as TranslationResult/ResponseResult — Local sets a fixed low value so
   * the router prefers Cloud whenever it's configured; Cloud leaves it
   * unset (accepted immediately, same as CloudTranslationProvider/
   * CloudResponseProvider). */
  confidence?: number;
}

export interface ExplanationProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ExplanationProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
  tier: ExplanationProviderTier;
}

/**
 * A meeting-sentence-explanation backend, local or cloud. One bounded piece
 * of text (+ context) in, one structured result out — same one-shot-per-call
 * shape as TranslationProvider/ResponseProvider.
 */
export interface ExplanationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: ExplanationProviderTier;
  start(config: ExplanationProviderConfig): Promise<void>;
  stop(): Promise<void>;
  explain(request: ExplanationRequest): Promise<ExplanationResult>;
  getStatus(): ExplanationProviderStatus;
  getCapabilities(): ExplanationProviderCapabilities;
}
