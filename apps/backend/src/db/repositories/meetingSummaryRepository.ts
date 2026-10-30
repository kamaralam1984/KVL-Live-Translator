import { randomUUID } from 'node:crypto';
import { db } from '../client';

interface MeetingSummaryRow {
  id: string;
  session_id: string;
  executive_summary: string;
  meeting_objective: string;
  key_discussion_points: string;
  suggested_next_steps: string;
  provider_id: string;
  created_at: string;
  updated_at: string;
}

export interface StoredSummary {
  id: string;
  sessionId: string;
  executiveSummary: string;
  meetingObjective: string;
  keyDiscussionPoints: string[];
  suggestedNextSteps: string[];
  providerId: string;
  createdAt: string;
  updatedAt: string;
}

function toDomain(row: MeetingSummaryRow): StoredSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    executiveSummary: row.executive_summary,
    meetingObjective: row.meeting_objective,
    keyDiscussionPoints: JSON.parse(row.key_discussion_points) as string[],
    suggestedNextSteps: JSON.parse(row.suggested_next_steps) as string[],
    providerId: row.provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const meetingSummaryRepository = {
  /** One row per session — a second save overwrites the first (matches
   * "Regenerate" semantics), never accumulates history rows. */
  upsert(
    sessionId: string,
    fields: { executiveSummary: string; meetingObjective: string; keyDiscussionPoints: string[]; suggestedNextSteps: string[]; providerId: string },
  ): StoredSummary {
    const now = new Date().toISOString();
    const existing = this.get(sessionId);

    if (existing) {
      db.prepare(
        `UPDATE meeting_summaries
         SET executive_summary = @executiveSummary, meeting_objective = @meetingObjective,
             key_discussion_points = @keyDiscussionPoints, suggested_next_steps = @suggestedNextSteps,
             provider_id = @providerId, updated_at = @updatedAt
         WHERE session_id = @sessionId`,
      ).run({
        sessionId,
        executiveSummary: fields.executiveSummary,
        meetingObjective: fields.meetingObjective,
        keyDiscussionPoints: JSON.stringify(fields.keyDiscussionPoints),
        suggestedNextSteps: JSON.stringify(fields.suggestedNextSteps),
        providerId: fields.providerId,
        updatedAt: now,
      });
    } else {
      db.prepare(
        `INSERT INTO meeting_summaries (id, session_id, executive_summary, meeting_objective, key_discussion_points, suggested_next_steps, provider_id, created_at, updated_at)
         VALUES (@id, @sessionId, @executiveSummary, @meetingObjective, @keyDiscussionPoints, @suggestedNextSteps, @providerId, @createdAt, @updatedAt)`,
      ).run({
        id: randomUUID(),
        sessionId,
        executiveSummary: fields.executiveSummary,
        meetingObjective: fields.meetingObjective,
        keyDiscussionPoints: JSON.stringify(fields.keyDiscussionPoints),
        suggestedNextSteps: JSON.stringify(fields.suggestedNextSteps),
        providerId: fields.providerId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return this.get(sessionId)!;
  },

  get(sessionId: string): StoredSummary | undefined {
    const row = db.prepare<[string], MeetingSummaryRow>('SELECT * FROM meeting_summaries WHERE session_id = ?').get(sessionId);
    return row ? toDomain(row) : undefined;
  },

  exists(sessionId: string): boolean {
    const row = db.prepare<[string], { one: number }>('SELECT 1 as one FROM meeting_summaries WHERE session_id = ?').get(sessionId);
    return Boolean(row);
  },

  delete(sessionId: string): void {
    db.prepare('DELETE FROM meeting_summaries WHERE session_id = ?').run(sessionId);
  },
};
