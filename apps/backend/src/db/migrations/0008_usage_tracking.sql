-- Phase 11: cost/usage ledger. Deliberately NOT CHECK-constrained on
-- provider_kind — every prior new-kind migration (0004-0007) needed the full
-- api_providers recreate-table dance solely because api_providers.kind is
-- CHECK-constrained; this is a ledger table, not a config table, so it won't
-- need touching when a hypothetical future 8th provider kind appears.
-- meeting_session_id uses ON DELETE SET NULL (not CASCADE, unlike every
-- other per-session table since Phase 10) — usage history is accounting
-- data and should survive a meeting being deleted.
CREATE TABLE usage_records (
  id                  TEXT PRIMARY KEY, -- uuid
  provider_kind       TEXT NOT NULL,
  provider_id         TEXT,             -- nullable: local/free providers aren't api_providers rows
  provider_label      TEXT NOT NULL,    -- denormalized display name, survives provider deletion
  tier                TEXT NOT NULL,    -- 'local' | 'free' | 'paid' | 'cloud' — stored as reported
  request_type        TEXT NOT NULL,    -- e.g. 'transcribe' | 'translate' | 'generate' | 'synthesize' | 'explain' | 'detect' | 'summarize'
  input_units         INTEGER NOT NULL DEFAULT 0,
  output_units        INTEGER NOT NULL DEFAULT 0,
  audio_seconds        REAL,
  estimated_cost_usd  REAL NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'USD',
  meeting_session_id  TEXT REFERENCES meeting_sessions(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_usage_created_at ON usage_records(created_at);
CREATE INDEX idx_usage_session ON usage_records(meeting_session_id);
CREATE INDEX idx_usage_kind ON usage_records(provider_kind);
