import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { TranslationMode, TranslationResultDTO } from '@kvl/shared';

interface HistoryRow {
  id: string;
  session_id: string;
  original_text: string;
  translated_text: string;
  suggested_reply: string | null;
  mode: TranslationMode;
  source_lang: string;
  target_lang: string;
  created_at: string;
}

function toDTO(row: HistoryRow): TranslationResultDTO {
  return {
    sessionId: row.session_id,
    originalText: row.original_text,
    translatedText: row.translated_text,
    suggestedReply: row.suggested_reply ?? undefined,
    mode: row.mode,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    createdAt: row.created_at,
  };
}

export const historyRepository = {
  insert(entry: TranslationResultDTO): void {
    db.prepare(
      `INSERT INTO translation_history
         (id, session_id, original_text, translated_text, suggested_reply, mode, source_lang, target_lang, created_at)
       VALUES (@id, @sessionId, @originalText, @translatedText, @suggestedReply, @mode, @sourceLang, @targetLang, @createdAt)`,
    ).run({ id: randomUUID(), ...entry, suggestedReply: entry.suggestedReply ?? null });
  },

  list(sessionId: string | undefined, limit: number, offset: number): { entries: TranslationResultDTO[]; total: number } {
    const where = sessionId ? 'WHERE session_id = ?' : '';
    const params = sessionId ? [sessionId] : [];

    const rows = db
      .prepare<unknown[], HistoryRow>(`SELECT * FROM translation_history ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const { count } = db
      .prepare<unknown[], { count: number }>(`SELECT COUNT(*) as count FROM translation_history ${where}`)
      .get(...params) ?? { count: 0 };

    return { entries: rows.map(toDTO), total: count };
  },
};
