import type { SpeechInputChunk, SpeechProvider, SpeechTranscriptionResult } from '@kvl/speech';
import { providerHealthRegistry } from '../providers/ProviderHealthRegistry';
import { PASSTHROUGH_COST_GATE, type CostGateLike } from '../cost/CostGate';

export interface RouterAttempt {
  providerId: string;
  succeeded: boolean;
  error?: string;
}

export interface RouterResult {
  result: SpeechTranscriptionResult;
  providerId: string;
  attempts: RouterAttempt[];
}

/**
 * Tries providers in order (local-first, then configured cloud fallbacks),
 * skipping any that report themselves unavailable, are rate-limited/
 * circuit-broken, or cost-mode-blocked (Phase 11 additions — this router
 * previously had NONE of that, unlike Translation/Response/Explanation,
 * which already used ProviderHealth before this phase). Falls through to
 * the next provider on failure. Matches the spec's "Local STT -> Provider 1
 * -> Provider 2" chain. Providers are injected, not looked up globally, so
 * this is testable with fake stubs.
 *
 * No 'quality' mode exhaust-and-pick-best here (unlike the confidence-based
 * routers) — this router has never gated on SpeechTranscriptionResult's
 * confidence field at all (first success wins, same as before Phase 11);
 * adding a new confidence-threshold behavior here would be a bigger change
 * than this phase's cost/health additions warrant.
 */
export class SpeechProviderRouter {
  constructor(
    private readonly providers: SpeechProvider[],
    private readonly costGate: CostGateLike = PASSTHROUGH_COST_GATE,
  ) {}

  async transcribeWithFallback(chunk: SpeechInputChunk): Promise<RouterResult> {
    const attempts: RouterAttempt[] = [];

    for (const provider of this.providers) {
      const capabilities = provider.getCapabilities();
      if (!capabilities.available) {
        attempts.push({ providerId: provider.id, succeeded: false, error: 'unavailable' });
        continue;
      }
      if (capabilities.requiresApiKey && !this.costGate.isPaidTierAllowed()) {
        attempts.push({ providerId: provider.id, succeeded: false, error: 'cost-mode-blocked' });
        continue;
      }

      const health = providerHealthRegistry.get(provider.id);
      if (!health.canAttempt()) {
        attempts.push({ providerId: provider.id, succeeded: false, error: 'rate-limited' });
        continue;
      }

      health.recordAttempt();
      try {
        const result = await provider.transcribe(chunk);
        health.recordSuccess();
        attempts.push({ providerId: provider.id, succeeded: true });
        return { result, providerId: provider.id, attempts };
      } catch (error) {
        health.recordError({});
        attempts.push({ providerId: provider.id, succeeded: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    throw new Error(`All speech providers failed or were unavailable: ${attempts.map((a) => `${a.providerId}(${a.error})`).join(', ')}`);
  }
}
