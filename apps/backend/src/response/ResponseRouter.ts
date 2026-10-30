import type { ResponseProvider, ResponseRequest, ResponseResult } from '@kvl/response';
import { protectTerms, restoreTerms } from '@kvl/shared';
import { providerHealthRegistry } from '../providers/ProviderHealthRegistry';
import { PASSTHROUGH_COST_GATE, type CostGateLike } from '../cost/CostGate';
import { passthroughCache, cacheKey, type RequestCache } from '../cost/RequestCache';

const DEFAULT_MIN_CONFIDENCE = 0.6;

export interface ResponseRouterAttempt {
  providerId: string;
  succeeded: boolean;
  reason?: 'unavailable' | 'unsupported-style' | 'rate-limited' | 'low-confidence' | 'error' | 'cost-mode-blocked';
  error?: string;
}

export interface ResponseRouterResult {
  result: ResponseResult;
  providerId: string;
  attempts: ResponseRouterAttempt[];
  cacheHit?: boolean;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota/i.test(message);
}

/**
 * Tries providers in fixed priority order (local -> free -> paid), skipping
 * any that are unavailable, don't support the requested style, are
 * rate-limited/circuit-broken, cost-mode-blocked (Phase 11), or whose
 * result confidence is too low — exact mirror of TranslationRouter.ts,
 * swapping mode/supportedModes for style/supportedStyles, including the
 * Phase 11 costGate/cache injection and 'quality' mode's exhaust-and-pick-
 * best behavior (see TranslationRouter.ts for the detailed rationale).
 */
export class ResponseRouter {
  constructor(
    private readonly providers: ResponseProvider[],
    private readonly minConfidence: number = DEFAULT_MIN_CONFIDENCE,
    private readonly costGate: CostGateLike = PASSTHROUGH_COST_GATE,
    private readonly cache: Pick<RequestCache<ResponseRouterResult>, 'get' | 'set'> = passthroughCache<ResponseRouterResult>(),
  ) {}

  async generateWithFallback(request: ResponseRequest): Promise<ResponseRouterResult> {
    const attempts: ResponseRouterAttempt[] = [];
    const { text: protectedText, mapping } = protectTerms(request.text);

    const key = cacheKey([request.text, request.style]);
    const cachingEnabled = this.costGate.isCachingEnabled();
    const cached = cachingEnabled ? this.cache.get(key) : undefined;
    if (cached) return { ...cached, cacheHit: true };

    let best: { result: ResponseResult; providerId: string; confidence: number } | null = null;

    for (const provider of this.providers) {
      const capabilities = provider.getCapabilities();

      if (!capabilities.available) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'unavailable' });
        continue;
      }
      if (!capabilities.supportedStyles.includes(request.style)) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'unsupported-style' });
        continue;
      }
      if (capabilities.requiresApiKey && !this.costGate.isPaidTierAllowed()) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'cost-mode-blocked' });
        continue;
      }

      const health = providerHealthRegistry.get(provider.id);
      if (!health.canAttempt()) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'rate-limited' });
        continue;
      }

      health.recordAttempt();
      try {
        const raw = await provider.generate({ ...request, text: protectedText });
        const threshold = capabilities.requiresApiKey ? this.minConfidence : this.costGate.localAcceptanceThreshold(this.minConfidence);

        if (typeof raw.confidence === 'number' && raw.confidence < threshold) {
          attempts.push({ providerId: provider.id, succeeded: false, reason: 'low-confidence' });
          continue; // not an error — just not good enough, keep looking
        }

        health.recordSuccess();
        const result: ResponseResult = { ...raw, englishText: restoreTerms(raw.englishText, mapping) };
        attempts.push({ providerId: provider.id, succeeded: true });

        if (this.costGate.mode !== 'quality') {
          const final = { result, providerId: provider.id, attempts };
          if (cachingEnabled) this.cache.set(key, final);
          return final;
        }
        const confidence = raw.confidence ?? 1;
        if (!best || confidence > best.confidence) best = { result, providerId: provider.id, confidence };
      } catch (error) {
        health.recordError({ isRateLimit: isRateLimitError(error) });
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (best) {
      const final = { result: best.result, providerId: best.providerId, attempts };
      if (cachingEnabled) this.cache.set(key, final);
      return final;
    }

    throw new Error(`All response providers failed, unavailable, or unsuitable: ${attempts.map((a) => `${a.providerId}(${a.reason ?? a.error})`).join(', ')}`);
  }
}
