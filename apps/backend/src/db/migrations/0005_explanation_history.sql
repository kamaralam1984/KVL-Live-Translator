-- Phase 8: an explanation_history table for "What does this mean?" saves,
-- and widening api_providers.kind to add 'explanation'. Unlike Phase 6's
-- session-less response_history, an explanation is always tied to a live
-- transcript, so session_id is a required FK here. SQLite has no ALTER
-- TABLE ... ALTER CHECK, so api_providers is recreated, same recipe as
-- 0003_translation_modes.sql / 0004_response_history.sql.

CREATE TABLE explanation_history (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  source_sentence       TEXT NOT NULL,
  context_mode          TEXT NOT NULL CHECK (context_mode IN ('selected','last-1min','last-5min','current-topic')),
  simple_meaning        TEXT NOT NULL,
  what_they_are_asking  TEXT NOT NULL,
  important_context     TEXT NOT NULL,
  terms_json            TEXT NOT NULL, -- JSON-encoded Array<{term,definition}>
  suggested_response    TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_explanation_history_session ON explanation_history(session_id);
CREATE INDEX idx_explanation_history_created ON explanation_history(created_at);

PRAGMA foreign_keys = OFF;

CREATE TABLE api_providers_new (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('stt','translation','response','tts','explanation')),
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
