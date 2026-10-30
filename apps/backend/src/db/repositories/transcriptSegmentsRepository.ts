import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { TranscriptSegment } from '@kvl/shared';

interface TranscriptSegmentRow {
  id: string;
  session_id: string;
  text: string;
  is_final: number;
  start_ms: number;
  end_ms: number;
  language_code: string | null;
  confidence: number | null;
  created_at: string;
}

function toDomain(row: TranscriptSegmentRow): TranscriptSegment {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    isFinal: Boolean(row.is_final),
    startMs: row.start_ms,
    endMs: row.end_ms,
    languageCode: row.language_code ?? undefined,
    confidence: row.confidence ?? undefined,
  };
}

export const transcriptSegmentsRepository = {
  insert(sessionId: string, segment: TranscriptSegment): void {
    db.prepare(
      `INSERT INTO transcript_segments (id, session_id, text, is_final, start_ms, end_ms, language_code, confidence, created_at)
       VALUES (@id, @sessionId, @text, @isFinal, @startMs, @endMs, @languageCode, @confidence, @createdAt)`,
    ).run({
      id: randomUUID(),
      sessionId,
      text: segment.text,
      isFinal: segment.isFinal ? 1 : 0,
      startMs: segment.startMs,
      endMs: segment.endMs,
      languageCode: segment.languageCode ?? null,
      confidence: segment.confidence ?? null,
      createdAt: new Date().toISOString(),
    });
  },

  /** Oldest first — the natural reading order for a transcript. */
  list(sessionId: string): TranscriptSegment[] {
    return db
      .prepare<[string], TranscriptSegmentRow>('SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY start_ms ASC')
      .all(sessionId)
      .map(toDomain);
  },

  count(sessionId: string): number {
    const row = db.prepare<[string], { count: number }>('SELECT COUNT(*) as count FROM transcript_segments WHERE session_id = ?').get(sessionId);
    return row?.count ?? 0;
  },

  /** Phase 13 transcript retention sweep — deletes only transcript_segments,
   * never meeting_summaries/copilot_items (those are governed independently
   * by the existing saveSummary setting, per Phase 10's confirmed-facts
   * design). Returns how many rows were deleted, for logging. */
  deleteOlderThan(cutoffIso: string): number {
    return db.prepare('DELETE FROM transcript_segments WHERE created_at < ?').run(cutoffIso).changes;
  },

  deleteBySession(sessionId: string): number {
    return db.prepare('DELETE FROM transcript_segments WHERE session_id = ?').run(sessionId).changes;
  },
};
