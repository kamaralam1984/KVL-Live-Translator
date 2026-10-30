import { randomUUID } from 'node:crypto';
import { db } from '../client';

export interface UsageRecordRow {
  id: string;
  provider_kind: string;
  provider_id: string | null;
  provider_label: string;
  tier: string;
  request_type: string;
  input_units: number;
  output_units: number;
  audio_seconds: number | null;
  estimated_cost_usd: number;
  currency: string;
  meeting_session_id: string | null;
  created_at: string;
}

export interface UsageRecordInsert {
  providerKind: string;
  providerId: string | null;
  providerLabel: string;
  tier: string;
  requestType: string;
  inputUnits: number;
  outputUnits: number;
  audioSeconds: number | null;
  estimatedCostUsd: number;
  meetingSessionId: string | null;
  createdAt: string;
}

export const usageRecordsRepository = {
  insert(entry: UsageRecordInsert): void {
    db.prepare(
      `INSERT INTO usage_records (id, provider_kind, provider_id, provider_label, tier, request_type, input_units, output_units, audio_seconds, estimated_cost_usd, currency, meeting_session_id, created_at)
       VALUES (@id, @providerKind, @providerId, @providerLabel, @tier, @requestType, @inputUnits, @outputUnits, @audioSeconds, @estimatedCostUsd, 'USD', @meetingSessionId, @createdAt)`,
    ).run({ id: randomUUID(), ...entry });
  },

  listSince(sinceIso: string): UsageRecordRow[] {
    return db.prepare<[string], UsageRecordRow>('SELECT * FROM usage_records WHERE created_at >= ? ORDER BY created_at ASC').all(sinceIso);
  },

  listForSession(sessionId: string): UsageRecordRow[] {
    return db.prepare<[string], UsageRecordRow>('SELECT * FROM usage_records WHERE meeting_session_id = ? ORDER BY created_at ASC').all(sessionId);
  },

  sumCostSince(sinceIso: string): number {
    const row = db.prepare<[string], { total: number | null }>('SELECT SUM(estimated_cost_usd) AS total FROM usage_records WHERE created_at >= ?').get(sinceIso);
    return row?.total ?? 0;
  },
};
