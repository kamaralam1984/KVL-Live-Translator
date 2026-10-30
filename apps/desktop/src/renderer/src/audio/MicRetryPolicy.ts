/**
 * Phase 14: bounded same-device auto-retry after a mic disconnect. Mirrors
 * wsClient.ts's scheduleReconnect shape (attempt counter -> delay lookup
 * table) but is deliberately BOUNDED — 3 attempts, then give up and let
 * AudioCaptureManager fall back to its existing terminal error state. Pure
 * and DOM-free so it's directly unit-testable without getUserMedia/AudioContext.
 */
export const MIC_RETRY_DELAYS_MS = [500, 1500, 3000];

export class MicRetryPolicy {
  private attempt = 0;

  get exhausted(): boolean {
    return this.attempt >= MIC_RETRY_DELAYS_MS.length;
  }

  get attemptNumber(): number {
    return this.attempt;
  }

  /** Returns the delay for the next attempt and advances the counter. */
  nextDelayMs(): number {
    const delay = MIC_RETRY_DELAYS_MS[this.attempt];
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}
