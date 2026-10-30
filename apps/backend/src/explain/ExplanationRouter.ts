import type { ExplanationProvider, ExplanationRequest, ExplanationResult } from '@kvl/explain';
import { providerHealthRegistry } from '../providers/ProviderHealthRegistry';
import { PASSTHROUGH_COST_GATE, type CostGateLike } from '../cost/CostGate';

const DEFAULT_MIN_CONFIDENCE = 0.6;

export interface ExplanationRouterAttempt {
  providerId: string;
  succeeded: boolean;
  reason?: 'unavailable' | 'rate-limited' | 'low-confidence' | 'error' | 'cost-mode-blocked';
  error?: string;
}

export interface ExplanationRouterResult {
  result: ExplanationResult;
  providerId: string;
  attempts: ExplanationRouterAttempt[];
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota/i.test(message);
}

/**
 * Tries providers in fixed priority order (local -> cloud), skipping any
 * that are unavailable, rate-limited/circuit-broken, cost-mode-blocked
 * (Phase 11), or whose result confidence is too low — mirror of
 * TranslationRouter.ts/ResponseRouter.ts, minus mode/style filtering and
 * caching (no cache — explanations are contextual, not spec-called-out).
 * LocalExplanationProvider's fixed low confidence is what makes it yield to
 * Cloud whenever Cloud is configured and cost mode allows it. In 'quality'
 * mode the loop doesn't stop at the first accepted result — see
 * TranslationRouter.ts for the detailed rationale.
 */
export class ExplanationRouter {
  constructor(
    private readonly providers: ExplanationProvider[],
    private readonly minConfidence: number = DEFAULT_MIN_CONFIDENCE,
    private readonly costGate: CostGateLike = PASSTHROUGH_COST_GATE,
  ) {}

  async explainWithFallback(request: ExplanationRequest): Promise<ExplanationRouterResult> {
    const attempts: ExplanationRouterAttempt[] = [];
    let bestLowConfidence: { result: ExplanationResult; providerId: string } | undefined;
    let bestAccepted: { result: ExplanationResult; providerId: string; confidence: number } | null = null;

    for (const provider of this.providers) {
      const capabilities = provider.getCapabilities();

      if (!capabilities.available) {
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'unavailable' });
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
        const result = await provider.explain(request);
        const threshold = capabilities.requiresApiKey ? this.minConfidence : this.costGate.localAcceptanceThreshold(this.minConfidence);

        if (typeof result.confidence === 'number' && result.confidence < threshold) {
          attempts.push({ providerId: provider.id, succeeded: false, reason: 'low-confidence' });
          bestLowConfidence ??= { result, providerId: provider.id }; // keep the first (highest-priority) partial result
          continue; // not an error — just not good enough, keep looking for something better
        }

        health.recordSuccess();
        attempts.push({ providerId: provider.id, succeeded: true });

        if (this.costGate.mode !== 'quality') return { result, providerId: provider.id, attempts };
        const confidence = result.confidence ?? 1;
        if (!bestAccepted || confidence > bestAccepted.confidence) bestAccepted = { result, providerId: provider.id, confidence };
      } catch (error) {
        health.recordError({ isRateLimit: isRateLimitError(error) });
        attempts.push({ providerId: provider.id, succeeded: false, reason: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (bestAccepted) return { result: bestAccepted.result, providerId: bestAccepted.providerId, attempts };

    // Nothing cleared the confidence bar, but a partial (honestly-labeled
    // low-confidence) result is still more useful than an error — e.g. no
    // cloud provider configured, only Local's partial explanation exists.
    if (bestLowConfidence) return { ...bestLowConfidence, attempts };

    throw new Error(`All explanation providers failed, unavailable, or unsuitable: ${attempts.map((a) => `${a.providerId}(${a.reason ?? a.error})`).join(', ')}`);
  }
}
