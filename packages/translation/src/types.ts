import type { TranslationMode } from '@kvl/shared';

export type TranslationProviderTier = 'local' | 'free' | 'paid';
export type TranslationProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface TranslationRequest {
  text: string;
  /** e.g. 'en' */
  sourceLang: string;
  /** e.g. 'hi' */
  targetLang: string;
  mode: TranslationMode;
  /** Recent turns, for coherence across a session. */
  context?: string[];
}

export interface TranslationResult {
  translatedText: string;
  /** English reply draft — feeds the "Suggested Reply" panel. */
  suggestedReply?: string;
  detectedLang?: string;
  /** Fraction of the input the provider was actually able to translate —
   * lets the router keep looking when a low-quality result (e.g. the
   * built-in phrasebook missing most words) isn't good enough, rather than
   * treating "it returned something" as success. */
  confidence?: number;
}

export interface TranslationProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface TranslationProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
  tier: TranslationProviderTier;
  /** Modes this provider can genuinely produce — see the Phase 4 plan's
   * note on why pure-NMT engines can't claim 'hinglish'/'simple-*'. */
  supportedModes: TranslationMode[];
}

/**
 * A translation backend, local or cloud. Phase 3's SpeechManager already
 * produces one TranscriptSegment per VAD-bounded speech chunk, so translate()
 * operates on one bounded piece of text at a time — no streaming protocol
 * needed here either.
 */
export interface TranslationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: TranslationProviderTier;
  start(config: TranslationProviderConfig): Promise<void>;
  stop(): Promise<void>;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  getStatus(): TranslationProviderStatus;
  getCapabilities(): TranslationProviderCapabilities;
}
