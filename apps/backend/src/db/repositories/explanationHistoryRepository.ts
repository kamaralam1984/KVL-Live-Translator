import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { ExplanationContextMode, ExplanationHistoryDTO, ExplanationTerm } from '@kvl/shared';

interface ExplanationHistoryRow {
  id: string;
  session_id: string;
  source_sentence: string;
  context_mode: ExplanationContextMode;
  simple_meaning: string;
  what_they_are_asking: string;
  important_context: string;
  terms_json: string;
  suggested_response: string;
  provider_id: string;
  created_at: string;
}

function toDTO(row: ExplanationHistoryRow): ExplanationHistoryDTO {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceSentence: row.source_sentence,
    contextMode: row.context_mode,
    simpleMeaning: row.simple_meaning,
    whatTheyAreAsking: row.what_they_are_asking,
    importantContext: row.important_context,
    terms: JSON.parse(row.terms_json) as ExplanationTerm[],
    suggestedResponse: row.suggested_response,
    providerId: row.provider_id,
    createdAt: row.created_at,
  };
}

export const explanationHistoryRepository = {
  insert(entry: {
    sessionId: string;
    sourceSentence: string;
    contextMode: ExplanationContextMode;
    simpleMeaning: string;
    whatTheyAreAsking: string;
    importantContext: string;
    terms: ExplanationTerm[];
    suggestedResponse: string;
    providerId: string;
    createdAt: string;
  }): ExplanationHistoryDTO {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO explanation_history
         (id, session_id, source_sentence, context_mode, simple_meaning, what_they_are_asking, important_context, terms_json, suggested_response, provider_id, created_at)
       VALUES (@id, @sessionId, @sourceSentence, @contextMode, @simpleMeaning, @whatTheyAreAsking, @importantContext, @termsJson, @suggestedResponse, @providerId, @createdAt)`,
    ).run({ id, ...entry, termsJson: JSON.stringify(entry.terms) });
    return { id, ...entry };
  },

  list(sessionId: string, limit: number, offset: number): { entries: ExplanationHistoryDTO[]; total: number } {
    const rows = db
      .prepare<unknown[], ExplanationHistoryRow>('SELECT * FROM explanation_history WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(sessionId, limit, offset);
    const { count } = db.prepare<[string], { count: number }>('SELECT COUNT(*) as count FROM explanation_history WHERE session_id = ?').get(sessionId) ?? { count: 0 };

    return { entries: rows.map(toDTO), total: count };
  },
};
