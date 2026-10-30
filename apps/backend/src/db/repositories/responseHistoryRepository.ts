import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { ResponseStyle, ResponseResultDTO } from '@kvl/shared';

interface ResponseHistoryRow {
  id: string;
  source_text: string;
  english_text: string;
  style: ResponseStyle;
  provider_id: string;
  created_at: string;
}

function toDTO(row: ResponseHistoryRow): ResponseResultDTO {
  return {
    id: row.id,
    sourceText: row.source_text,
    englishText: row.english_text,
    style: row.style,
    providerId: row.provider_id,
    createdAt: row.created_at,
  };
}

export const responseHistoryRepository = {
  insert(entry: { sourceText: string; englishText: string; style: ResponseStyle; providerId: string; createdAt: string }): ResponseResultDTO {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO response_history
         (id, source_text, english_text, style, provider_id, created_at)
       VALUES (@id, @sourceText, @englishText, @style, @providerId, @createdAt)`,
    ).run({ id, ...entry });
    return { id, ...entry };
  },

  list(limit: number, offset: number): { entries: ResponseResultDTO[]; total: number } {
    const rows = db
      .prepare<unknown[], ResponseHistoryRow>('SELECT * FROM response_history ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
    const { count } = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM response_history').get() ?? { count: 0 };

    return { entries: rows.map(toDTO), total: count };
  },
};
