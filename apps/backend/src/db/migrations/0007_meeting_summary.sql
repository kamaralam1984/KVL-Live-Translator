-- Phase 10: durable transcript persistence (transcript_segments, gated by
-- the saveTranscript setting — see TranscriptPersistence.ts), a
-- meeting_summaries table (only the 4 AI-synthesized fields — the other 7
-- summary sections are a live query of copilot_items, never stored here),
-- and widening api_providers.kind to add 'summary'.

CREATE TABLE transcript_segments (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  text           TEXT NOT NULL,
  is_final       INTEGER NOT NULL,
  start_ms       INTEGER NOT NULL,
  end_ms         INTEGER NOT NULL,
  language_code  TEXT,
  confidence     REAL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_transcript_segments_session ON transcript_segments(session_id);

CREATE TABLE meeting_summaries (
  id                     TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL UNIQUE REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  executive_summary      TEXT NOT NULL,
  meeting_objective      TEXT NOT NULL,
  key_discussion_points  TEXT NOT NULL, -- JSON-encoded string[]
  suggested_next_steps   TEXT NOT NULL, -- JSON-encoded string[]
  provider_id            TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

PRAGMA foreign_keys = OFF;

CREATE TABLE api_providers_new (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('stt','translation','response','tts','explanation','copilot','summary')),
  name               TEXT NOT NULL,
  provider_key       TEXT NOT NULL,
  base_url           TEXT,
  model              TEXT,
  encrypted_api_key  BLOB,
  is_active          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

INSERT INTO api_providers_new (id, kind, name, provider_key, base_url, model, encrypted_api_key, is_active, created_at, updated_at)
SELECT id, kind, name, provider_key, base_url, model, encrypted_api_key, is_active, created_at, updated_at
FROM api_providers;

DROP TABLE api_providers;
ALTER TABLE api_providers_new RENAME TO api_providers;

CREATE UNIQUE INDEX idx_providers_kind_active ON api_providers(kind) WHERE is_active = 1;

PRAGMA foreign_keys = ON;
