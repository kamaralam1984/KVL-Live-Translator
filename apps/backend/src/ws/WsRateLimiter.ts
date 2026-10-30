const DEFAULT_MAX_MESSAGES = 200;
const DEFAULT_WINDOW_MS = 10_000;

/**
 * Same rolling-timestamp-array shape as packages/shared/src/ProviderHealth.ts
 * (deterministic via an explicit `now` param) — one instance per WS
 * connection. Guards against a flood of messages both DoS-ing the backend
 * and, since Phase 11, driving up real cloud spend via a flood of e.g.
 * response:generate requests.
 */
export class WsRateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxMessages: number = DEFAULT_MAX_MESSAGES,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
  ) {}

  /** Records this message and returns whether the connection is still
   * within its allowed rate. */
  recordAndCheck(now: number = Date.now()): boolean {
    this.timestamps.push(now);
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length <= this.maxMessages;
  }
}
