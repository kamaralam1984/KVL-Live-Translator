export interface ProviderHealthOptions {
  /** Self-imposed cap — "never bypass rate limits" means staying under a
   * conservative ceiling proactively, not just reacting after a 429. */
  maxRequestsPerMinute?: number;
  /** Consecutive failures before the circuit opens (provider skipped entirely for a while). */
  maxConsecutiveErrors?: number;
  /** How long a provider is skipped after it reports a rate-limit error. */
  rateLimitCooldownMs?: number;
  /** How long the circuit breaker stays open after tripping. */
  circuitCooldownMs?: number;
}

const DEFAULTS: Required<ProviderHealthOptions> = {
  maxRequestsPerMinute: 20,
  maxConsecutiveErrors: 3,
  rateLimitCooldownMs: 60_000,
  circuitCooldownMs: 30_000,
};

/**
 * Per-provider health tracker: rolling request-count quota, rate-limit
 * cooldown, and a consecutive-error circuit breaker. All methods accept an
 * explicit `now` so this is deterministically unit-testable without real
 * timers. Originally built for the translation router (Phase 4), moved here
 * once the response router (Phase 6) needed the identical logic.
 */
export class ProviderHealth {
  private requestTimestamps: number[] = [];
  private consecutiveErrors = 0;
  private rateLimitedUntil = 0;
  private circuitOpenUntil = 0;
  private readonly options: Required<ProviderHealthOptions>;

  constructor(options: ProviderHealthOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  canAttempt(now: number = Date.now()): boolean {
    if (now < this.rateLimitedUntil) return false;
    if (now < this.circuitOpenUntil) return false;
    const recentCount = this.requestTimestamps.filter((t) => now - t < 60_000).length;
    return recentCount < this.options.maxRequestsPerMinute;
  }

  recordAttempt(now: number = Date.now()): void {
    this.requestTimestamps.push(now);
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  recordError(options: { isRateLimit?: boolean } = {}, now: number = Date.now()): void {
    this.consecutiveErrors += 1;
    if (options.isRateLimit) {
      this.rateLimitedUntil = now + this.options.rateLimitCooldownMs;
    }
    if (this.consecutiveErrors >= this.options.maxConsecutiveErrors) {
      this.circuitOpenUntil = now + this.options.circuitCooldownMs;
    }
  }

  get snapshot() {
    return {
      requestsInLastMinute: this.requestTimestamps.length,
      consecutiveErrors: this.consecutiveErrors,
      rateLimitedUntil: this.rateLimitedUntil,
      circuitOpenUntil: this.circuitOpenUntil,
    };
  }

  /** Computed status for dashboards — doesn't know about DB state (e.g. a
   * provider kind with no configured key at all), so 'disabled' is not a
   * possible value here; the caller cross-references that separately. */
  status(now: number = Date.now()): 'healthy' | 'degraded' | 'rate-limited' | 'unavailable' {
    if (now < this.circuitOpenUntil) return 'unavailable';
    if (now < this.rateLimitedUntil) return 'rate-limited';
    if (this.consecutiveErrors > 0) return 'degraded';
    return 'healthy';
  }
}
