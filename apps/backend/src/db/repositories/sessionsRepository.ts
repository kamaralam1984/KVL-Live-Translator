import { db } from '../client';
import type { AudioFormat, CaptureMode, MeetingHistoryEntryDTO, MeetingSession, TranslationMode } from '@kvl/shared';

interface SessionRow {
  id: string;
  title: string | null;
  mode: TranslationMode;
  started_at: string;
  ended_at: string | null;
  capture_mode: CaptureMode | null;
  audio_format: string | null;
  mic_device_label: string | null;
}

interface MeetingHistoryRow {
  session_id: string;
  title: string | null;
  mode: TranslationMode;
  started_at: string;
  ended_at: string | null;
  segment_count: number;
  action_item_count: number;
  has_summary: number;
}

function toSession(row: SessionRow): MeetingSession {
  return {
    id: row.id,
    title: row.title ?? undefined,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    captureMode: row.capture_mode ?? undefined,
    audioFormat: row.audio_format ? (JSON.parse(row.audio_format) as AudioFormat) : undefined,
    micDeviceLabel: row.mic_device_label ?? undefined,
  };
}

export interface CreateSessionInput {
  captureMode?: CaptureMode;
  audioFormat?: AudioFormat;
  micDeviceLabel?: string;
}

export const sessionsRepository = {
  create(id: string, mode: TranslationMode, title?: string, extra: CreateSessionInput = {}): MeetingSession {
    const startedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO meeting_sessions (id, title, mode, started_at, capture_mode, audio_format, mic_device_label)
       VALUES (@id, @title, @mode, @startedAt, @captureMode, @audioFormat, @micDeviceLabel)`,
    ).run({
      id,
      title: title ?? null,
      mode,
      startedAt,
      captureMode: extra.captureMode ?? null,
      audioFormat: extra.audioFormat ? JSON.stringify(extra.audioFormat) : null,
      micDeviceLabel: extra.micDeviceLabel ?? null,
    });
    return { id, title, mode, startedAt, ...extra };
  },

  end(id: string): void {
    db.prepare('UPDATE meeting_sessions SET ended_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  },

  get(id: string): MeetingSession | undefined {
    const row = db.prepare<[string], SessionRow>('SELECT * FROM meeting_sessions WHERE id = ?').get(id);
    return row ? toSession(row) : undefined;
  },

  /** Phase 14 crash recovery: a row with started_at set and ended_at still
   * NULL means end() was never called for it — the only path that sets
   * ended_at is a normal session:end/shutdown, so a crash or force-quit
   * leaves exactly this signature behind. Callers should additionally
   * exclude any id that sessionManager.isActive() still reports true for
   * (a session genuinely in progress right now, not a crash leftover). */
  findInterrupted(): MeetingSession[] {
    const rows = db
      .prepare<[], SessionRow>('SELECT * FROM meeting_sessions WHERE ended_at IS NULL ORDER BY started_at DESC')
      .all();
    return rows.map(toSession);
  },

  /** Deletes every session — translation_history rows cascade-delete with them. */
  deleteAll(): void {
    db.prepare('DELETE FROM meeting_sessions').run();
  },

  /** Permanently deletes one meeting — every per-session table
   * (translation_history, explanation_history, copilot_items,
   * transcript_segments, meeting_summaries) cascade-deletes with it
   * (PRAGMA foreign_keys = ON, set in db/client.ts). */
  delete(id: string): void {
    db.prepare('DELETE FROM meeting_sessions WHERE id = ?').run(id);
  },

  /** Backs Phase 10's Meeting History screen — Date/Duration/Title/Language/
   * segment count/action-item count/summary status, exactly the phase's own
   * list, via one aggregate query rather than N+1 round trips per meeting. */
  listMeetingHistory(): MeetingHistoryEntryDTO[] {
    const rows = db
      .prepare<[], MeetingHistoryRow>(
        `SELECT
           ms.id as session_id, ms.title, ms.mode, ms.started_at, ms.ended_at,
           (SELECT COUNT(*) FROM transcript_segments ts WHERE ts.session_id = ms.id) as segment_count,
           (SELECT COUNT(*) FROM copilot_items ci WHERE ci.session_id = ms.id AND ci.category = 'action-item') as action_item_count,
           (SELECT COUNT(*) FROM meeting_summaries msu WHERE msu.session_id = ms.id) as has_summary
         FROM meeting_sessions ms
         ORDER BY ms.started_at DESC`,
      )
      .all();

    return rows.map((row) => ({
      sessionId: row.session_id,
      title: row.title ?? undefined,
      language: row.mode,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      durationMs: row.ended_at ? new Date(row.ended_at).getTime() - new Date(row.started_at).getTime() : undefined,
      segmentCount: row.segment_count,
      actionItemCount: row.action_item_count,
      hasSummary: Boolean(row.has_summary),
    }));
  },
};
