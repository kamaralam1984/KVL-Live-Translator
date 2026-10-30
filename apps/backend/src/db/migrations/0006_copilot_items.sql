-- Phase 9: a copilot_items table for automatically-detected meeting items
-- (questions/decisions/action items/deadlines/requirements/objections/
-- pricing discussions/technical requirements/follow-ups/client requests),
-- and widening api_providers.kind to add 'copilot'. One unified table for
-- all 10 categories, not 7+ near-duplicate ones (see the Phase 9 plan) —
-- always tied to a live meeting, so session_id is a required FK, same as
-- 0005_explanation_history.sql. SQLite has no ALTER TABLE ... ALTER CHECK,
-- so api_providers is recreated, same recipe as every prior kind-widening
-- migration.

CREATE TABLE copilot_items (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  category      TEXT NOT NULL CHECK (category IN ('question','decision','action-item','deadline','requirement','objection','pricing-discussion','technical-requirement','follow-up','client-request')),
  description   TEXT NOT NULL,
  source_text   TEXT NOT NULL,
  timestamp_ms  INTEGER NOT NULL,
  confidence    REAL NOT NULL,
  owner         TEXT,
  due_text      TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','completed')),
  provider_id   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_copilot_items_session ON copilot_items(session_id);
CREATE INDEX idx_copilot_items_created ON copilot_items(created_at);

PRAGMA foreign_keys = OFF;

CREATE TABLE api_providers_new (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('stt','translation','response','tts','explanation','copilot')),
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
