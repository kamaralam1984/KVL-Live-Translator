import { ProviderHealth } from '@kvl/shared';

/**
 * One shared health tracker per provider DB id, used by every router that
 * previously kept its own private `Map<string, ProviderHealth>`
 * (TranslationRouter/ResponseRouter/ExplanationRouter) plus
 * SpeechProviderRouter, which had no health tracking at all before Phase 11.
 * Safe to centralize because `api_providers` rows are per-kind — a DB id
 * never spans two pipelines, so this doesn't merge two routers' rate-limit
 * counters together. What it adds is a single place to query "how is every
 * provider doing right now" for the Admin/Debug screen and Provider
 * Settings health badges — not a correctness fix for two configs sharing
 * one real upstream API key, which still isn't tracked jointly.
 */
class ProviderHealthRegistry {
  private readonly health = new Map<string, ProviderHealth>();

  get(providerId: string): ProviderHealth {
    let entry = this.health.get(providerId);
    if (!entry) {
      entry = new ProviderHealth();
      this.health.set(providerId, entry);
    }
    return entry;
  }

  snapshot(now: number = Date.now()): Array<{ providerId: string; status: ReturnType<ProviderHealth['status']> } & ProviderHealth['snapshot']> {
    return Array.from(this.health.entries()).map(([providerId, health]) => ({
      providerId,
      status: health.status(now),
      ...health.snapshot,
    }));
  }
}

export const providerHealthRegistry = new ProviderHealthRegistry();
