import { randomUUID } from 'node:crypto';
import { db } from '../client';
import type { ProviderConfigInput, ProviderConfigPublic, ProviderKind } from '@kvl/shared';

interface ProviderRow {
  id: string;
  kind: ProviderKind;
  name: string;
  provider_key: string;
  base_url: string | null;
  model: string | null;
  encrypted_api_key: Buffer | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function toPublic(row: ProviderRow): ProviderConfigPublic {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    providerKey: row.provider_key,
    baseUrl: row.base_url ?? undefined,
    model: row.model ?? undefined,
    hasApiKey: row.encrypted_api_key != null,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const providersRepository = {
  list(): ProviderConfigPublic[] {
    const rows = db.prepare<[], ProviderRow>('SELECT * FROM api_providers ORDER BY created_at ASC').all();
    return rows.map(toPublic);
  },

  upsert(input: ProviderConfigInput): ProviderConfigPublic {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const encryptedKey = input.encryptedApiKey ? Buffer.from(input.encryptedApiKey, 'base64') : null;

    if (input.isActive) {
      db.prepare('UPDATE api_providers SET is_active = 0 WHERE kind = ? AND id != ?').run(input.kind, id);
    }

    db.prepare(
      `INSERT INTO api_providers (id, kind, name, provider_key, base_url, model, encrypted_api_key, is_active, created_at, updated_at)
       VALUES (@id, @kind, @name, @providerKey, @baseUrl, @model, @encryptedApiKey, @isActive, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, provider_key = excluded.provider_key, base_url = excluded.base_url,
         model = excluded.model,
         encrypted_api_key = COALESCE(excluded.encrypted_api_key, api_providers.encrypted_api_key),
         is_active = excluded.is_active, updated_at = excluded.updated_at`,
    ).run({
      id,
      kind: input.kind,
      name: input.name,
      providerKey: input.providerKey,
      baseUrl: input.baseUrl ?? null,
      model: input.model ?? null,
      encryptedApiKey: encryptedKey,
      isActive: input.isActive ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    const row = db.prepare<[string], ProviderRow>('SELECT * FROM api_providers WHERE id = ?').get(id)!;
    return toPublic(row);
  },

  delete(id: string): void {
    db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);
  },

  /** Returns the raw safeStorage-encrypted blob (never decrypted here — see apps/backend/src/speech/keyRelay.ts). */
  getEncryptedKey(id: string): Buffer | null {
    const row = db.prepare<[string], { encrypted_api_key: Buffer | null }>('SELECT encrypted_api_key FROM api_providers WHERE id = ?').get(id);
    return row?.encrypted_api_key ?? null;
  },

  getActiveByKind(kind: ProviderKind): ProviderConfigPublic | undefined {
    const row = db.prepare<[ProviderKind], ProviderRow>('SELECT * FROM api_providers WHERE kind = ? AND is_active = 1').get(kind);
    return row ? toPublic(row) : undefined;
  },
};
