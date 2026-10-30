-- Phase 6: a response_history table for the Hindi/Hinglish -> English
-- response drafts, and widening api_providers.kind to add 'response'.
-- No session_id FK on response_history — this tool is usable independent of
-- an active meeting session. SQLite has no ALTER TABLE ... ALTER CHECK, so
-- api_providers is recreated, same recipe as 0003_translation_modes.sql.

CREATE TABLE response_history (
  id            TEXT PRIMARY KEY,
  source_text   TEXT NOT NULL,
  english_text  TEXT NOT NULL,
  style         TEXT NOT NULL CHECK (style IN ('professional','friendly','short','detailed','client-friendly','technical','simple-english')),
  provider_id   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_response_history_created ON response_history(created_at);

PRAGMA foreign_keys = OFF;

CREATE TABLE api_providers_new (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('stt','translation','response','tts')),
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
