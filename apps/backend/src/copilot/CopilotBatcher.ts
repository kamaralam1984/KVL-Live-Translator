export interface BufferedSegment {
  text: string;
  timestampMs: number;
  /** From EventDetector.scoreSignal — 0 if nothing matched. */
  signalScore: number;
}

export type FlushReason = 'max-segments' | 'max-wait' | 'high-signal';

export interface FlushBatch {
  segments: BufferedSegment[];
  reason: FlushReason;
}

export interface CopilotBatcherOptions {
  maxBatchSegments?: number;
  maxBatchWaitMs?: number;
  highSignalFlushThreshold?: number;
  minFlushIntervalMs?: number;
}

interface SessionState {
  segments: BufferedSegment[];
  bufferStartedAt: number;
  lastFlushAt: number;
}

const DEFAULTS: Required<CopilotBatcherOptions> = {
  maxBatchSegments: 6,
  maxBatchWaitMs: 25_000,
  highSignalFlushThreshold: 0.7,
  minFlushIntervalMs: 8_000,
};

/**
 * Decides WHEN a session's buffered segments are worth one cloud LLM call —
 * this is the actual "do not continuously send every transcript word"
 * mechanism (see EventDetector.ts for WHETHER a segment has signal at all).
 * Deliberately synchronous and timer-free internally — every method takes
 * an explicit `now`, same deterministic-clock convention as
 * packages/shared/src/ProviderHealth.ts, so tests never wait on a real
 * setTimeout. CopilotManager owns the one real periodic timer that calls
 * checkTimeout() for active sessions (see its own file).
 */
export class CopilotBatcher {
  private readonly sessions = new Map<string, SessionState>();
  private readonly options: Required<CopilotBatcherOptions>;

  constructor(options: CopilotBatcherOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Returns a batch to flush if this addition should trigger one, or null
   * to keep buffering. */
  addSegment(sessionId: string, segment: BufferedSegment, now: number): FlushBatch | null {
    const state = this.getOrCreate(sessionId, now);
    if (state.segments.length === 0) state.bufferStartedAt = now;
    state.segments.push(segment);

    if (segment.signalScore >= this.options.highSignalFlushThreshold && now - state.lastFlushAt >= this.options.minFlushIntervalMs) {
      return this.flush(sessionId, now, 'high-signal');
    }
    if (state.segments.length >= this.options.maxBatchSegments) {
      return this.flush(sessionId, now, 'max-segments');
    }
    return null;
  }

  /** Call periodically for sessions with a non-empty buffer — the max-wait
   * trigger doesn't need a new segment to fire. A buffer that's timed out
   * with zero real signal in it is dropped instead of flushed — the actual
   * cost-saving behavior, not just smaller batches. */
  checkTimeout(sessionId: string, now: number): FlushBatch | null {
    const state = this.sessions.get(sessionId);
    if (!state || state.segments.length === 0) return null;
    if (now - state.bufferStartedAt < this.options.maxBatchWaitMs) return null;

    const hasSignal = state.segments.some((s) => s.signalScore > 0);
    if (!hasSignal) {
      state.segments = [];
      return null;
    }
    return this.flush(sessionId, now, 'max-wait');
  }

  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  activeSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Phase 14 performance dashboard — segments currently buffered, awaiting a flush. */
  getBufferedCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.segments.length ?? 0;
  }

  private getOrCreate(sessionId: string, now: number): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { segments: [], bufferStartedAt: now, lastFlushAt: 0 };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private flush(sessionId: string, now: number, reason: FlushReason): FlushBatch {
    const state = this.sessions.get(sessionId)!;
    const segments = state.segments;
    state.segments = [];
    state.lastFlushAt = now;
    return { segments, reason };
  }
}
