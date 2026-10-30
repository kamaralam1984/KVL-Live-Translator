import type { ResponseStyle } from '@kvl/shared';

export type ResponseProviderTier = 'local' | 'free' | 'paid';
export type ResponseProviderStatus = 'unavailable' | 'initializing' | 'ready' | 'busy' | 'error';

export interface ResponseRequest {
  /** The user's raw Hindi/Hinglish text, from speech or typed directly. */
  text: string;
  style: ResponseStyle;
}

export interface ResponseResult {
  englishText: string;
  detectedLang?: string;
  /** Fraction of the input the provider was actually able to translate —
   * same low-quality-keeps-looking convention as TranslationResult.confidence. */
  confidence?: number;
}

export interface ResponseProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ResponseProviderCapabilities {
  id: string;
  displayName: string;
  available: boolean;
  offline: boolean;
  requiresApiKey: boolean;
  tier: ResponseProviderTier;
  /** Styles this provider can genuinely produce — pure-NMT/literal engines
   * can only manage a plain 'professional'-ish default, not real restyling
   * (see the Phase 6 plan's note on why only the cloud provider claims all 7). */
  supportedStyles: ResponseStyle[];
}

/**
 * A Hindi/Hinglish -> professional-English response backend, local or
 * cloud. One bounded piece of text in, one rewritten result out — same
 * one-shot-per-call shape as TranslationProvider, no streaming protocol.
 */
export interface ResponseProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: ResponseProviderTier;
  start(config: ResponseProviderConfig): Promise<void>;
  stop(): Promise<void>;
  generate(request: ResponseRequest): Promise<ResponseResult>;
  getStatus(): ResponseProviderStatus;
  getCapabilities(): ResponseProviderCapabilities;
}
