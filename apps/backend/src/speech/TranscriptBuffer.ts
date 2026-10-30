import type { TranscriptSegment } from '@kvl/shared';

/**
 * Per-session ordered transcript. Async provider responses can complete
 * out of order (a fast local chunk finishing after a slow cloud-fallback
 * chunk started earlier) — insert() keeps segments sorted by startMs rather
 * than assuming arrival order is temporal order.
 */
export class TranscriptBuffer {
  private readonly sessions = new Map<string, TranscriptSegment[]>();

  insert(segment: TranscriptSegment): void {
    const segments = this.sessions.get(segment.sessionId) ?? [];
    const insertAt = segments.findIndex((existing) => existing.startMs > segment.startMs);
    if (insertAt === -1) segments.push(segment);
    else segments.splice(insertAt, 0, segment);
    this.sessions.set(segment.sessionId, segments);
  }

  getSegments(sessionId: string): TranscriptSegment[] {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
