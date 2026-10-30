import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { CopilotCategory, CopilotItemDTO, CopilotItemStatus } from '@kvl/shared';

interface CopilotItemRow {
  id: string;
  session_id: string;
  category: CopilotCategory;
  description: string;
  source_text: string;
  timestamp_ms: number;
  confidence: number;
  owner: string | null;
  due_text: string | null;
  status: CopilotItemStatus;
  provider_id: string;
  created_at: string;
}

function toDTO(row: CopilotItemRow): CopilotItemDTO {
  return {
    id: row.id,
    sessionId: row.session_id,
    category: row.category,
    description: row.description,
    sourceText: row.source_text,
    timestampMs: row.timestamp_ms,
    confidence: row.confidence,
    owner: row.owner ?? undefined,
    dueText: row.due_text ?? undefined,
    status: row.status,
    providerId: row.provider_id,
    createdAt: row.created_at,
  };
}

export const copilotItemsRepository = {
  insert(entry: {
    sessionId: string;
    category: CopilotCategory;
    description: string;
    sourceText: string;
    timestampMs: number;
    confidence: number;
    owner?: string;
    dueText?: string;
    providerId: string;
    createdAt: string;
  }): CopilotItemDTO {
    const id = randomUUID();
    const status: CopilotItemStatus = 'new';
    db.prepare(
      `INSERT INTO copilot_items
         (id, session_id, category, description, source_text, timestamp_ms, confidence, owner, due_text, status, provider_id, created_at)
       VALUES (@id, @sessionId, @category, @description, @sourceText, @timestampMs, @confidence, @owner, @dueText, @status, @providerId, @createdAt)`,
    ).run({ id, status, ...entry, owner: entry.owner ?? null, dueText: entry.dueText ?? null });
    return { id, status, ...entry };
  },

  list(sessionId: string): CopilotItemDTO[] {
    return db
      .prepare<[string], CopilotItemRow>('SELECT * FROM copilot_items WHERE session_id = ? ORDER BY timestamp_ms ASC')
      .all(sessionId)
      .map(toDTO);
  },

  get(id: string): CopilotItemDTO | undefined {
    const row = db.prepare<[string], CopilotItemRow>('SELECT * FROM copilot_items WHERE id = ?').get(id);
    return row ? toDTO(row) : undefined;
  },

  setStatus(id: string, status: CopilotItemStatus): CopilotItemDTO | undefined {
    db.prepare('UPDATE copilot_items SET status = ? WHERE id = ?').run(status, id);
    return this.get(id);
  },

  update(id: string, patch: { description?: string; owner?: string; dueText?: string }): CopilotItemDTO | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    db.prepare('UPDATE copilot_items SET description = ?, owner = ?, due_text = ? WHERE id = ?').run(
      patch.description ?? current.description,
      patch.owner ?? current.owner ?? null,
      patch.dueText ?? current.dueText ?? null,
      id,
    );
    return this.get(id);
  },

  delete(id: string): void {
    db.prepare('DELETE FROM copilot_items WHERE id = ?').run(id);
  },
};
