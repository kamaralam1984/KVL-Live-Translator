import type { TranslationProvider, TranslationRequest, TranslationResult } from '@kvl/translation';
import { protectTerms, restoreTerms } from '@kvl/shared';
import { providerHealthRegistry } from '../providers/ProviderHealthRegistry';
import { PASSTHROUGH_COST_GATE, type CostGateLike } from '../cost/CostGate';
import { passthroughCache, cacheKey, type RequestCache } from '../cost/RequestCache';

const DEFAULT_MIN_CONFIDENCE = 0.6;

export interface RouterAttempt {
  providerId: string;
  succeeded: boolean;
  reason?: 'unavailable' | 'unsupported-mode' | 'rate-limited' | 'low-confidence' | 'error' | 'cost-mode-blocked';
  error?: string;
}

export interface TranslationRouterResult {
  result: TranslationResult;
  providerId: string;
  attempts: RouterAttempt[];
  /** True when served from the RequestCache without touching any provider
   * — the Manager uses this to skip cost recording (no call was made). */
  cacheHit?: boolean;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota/i.test(message);
}

/**
 * Tries providers in the fixed priority order they're constructed with
 * (local -> free -> paid, per spec), skipping any that are unavailable,
 * don't support the requested mode, are rate-limited/circuit-broken, cost
 * -mode-blocked (Phase 11 — see costGate), or whose result confidence is
 * too low to accept — "intelligent routing" layered on top of the fixed
 * tier order, not a replacement for it. Glossary term protection happens
 * once here, not per-provider.
 *
 * `costGate` and `cache` are optional (default to permissive no-ops) so
 * every pre-Phase-11 unit test that constructs this router directly with
 * fake providers keeps passing unmodified. In 'quality' cost mode the loop
 * does NOT return on the first accepted result — it keeps evaluating every
 * remaining allowed provider and returns the single highest-confidence
 * success, which is what actually gives 'quality' distinct behavior from
 * 'balanced' (both otherwise reach exactly the same providers).
 */
export class TranslationRouter {
  constructor(
    private readonly providers: TranslationProvider[],
    private readonly minConfidence: number = DEFAULT_MIN_CONFIDENCE,
    private readonly costGate: CostGateLike = PASSTHROUGH_COST_GATE,
    private readonly cache: Pick<RequestCache<TranslationRouterResult>, 'get' | 'set'> = passthroughCache<TranslationRouterResult>(),
  ) {}

  async translateWithFallback(request: TranslationRequest): Promise<TranslationRouterResult> {
    const attempts: RouterAttempt[] = [];
    const { text: protectedText, mapping } = protectTerms(request.text);

    const key = cacheKey([request.text, request.mode]);
    const cachingEnabled = this.costGate.isCachingEnabled();
    const cached = cachingEnabled ? this.cache.get(key) : undefined;
    if (cached) return { ...cached, cacheHit: true };

    let best: { result: TranslationResult; providerId: string; confidence: number } | null = null;

    for (const provider of this.providers) {
      const capabilities = provider.getCapabilities();

      if (!capabilities.available) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'unavailable' });
        continue;
      }
      if (!capabilities.supportedModes.includes(request.mode)) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'unsupported-mode' });
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
        const raw = await provider.translate({ ...request, text: protectedText });
        const threshold = capabilities.requiresApiKey ? this.minConfidence : this.costGate.localAcceptanceThreshold(this.minConfidence);

        if (typeof raw.confidence === 'number' && raw.confidence < threshold) {
          attempts.push({ providerId: provider.id, succeeded: false, reason: 'low-confidence' });
          continue; // not an error — just not good enough, keep looking
        }

        health.recordSuccess();
        const result: TranslationResult = {
          ...raw,
          translatedText: restoreTerms(raw.translatedText, mapping),
          suggestedReply: raw.suggestedReply ? restoreTerms(raw.suggestedReply, mapping) : undefined,
        };
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

    throw new Error(`All translation providers failed, unavailable, or unsuitable: ${attempts.map((a) => `${a.providerId}(${a.reason ?? a.error})`).join(', ')}`);
  }
}
