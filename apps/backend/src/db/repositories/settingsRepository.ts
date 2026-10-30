import { db } from '../client';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export const settingsRepository = {
  getAll(): Record<string, unknown> {
    const rows = db.prepare<[], SettingRow>('SELECT key, value, updated_at FROM app_settings').all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  },

  update(patch: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const tx = db.transaction((entries: [string, unknown][]) => {
      for (const [key, value] of entries) {
        upsert.run({ key, value: JSON.stringify(value), updated_at: now });
      }
    });
    tx(Object.entries(patch));
  },
};
