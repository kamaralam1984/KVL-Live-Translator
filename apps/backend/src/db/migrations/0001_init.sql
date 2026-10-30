CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,        -- JSON-encoded
  updated_at  TEXT NOT NULL
);

CREATE TABLE meeting_sessions (
  id          TEXT PRIMARY KEY,     -- uuid
  title       TEXT,
  mode        TEXT NOT NULL CHECK (mode IN ('formal','hinglish')),
  started_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE TABLE translation_history (
  id              TEXT PRIMARY KEY, -- uuid
  session_id      TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  original_text   TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  suggested_reply TEXT,
  mode            TEXT NOT NULL CHECK (mode IN ('formal','hinglish')),
  source_lang     TEXT NOT NULL,
  target_lang     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_history_session ON translation_history(session_id);
CREATE INDEX idx_history_created ON translation_history(created_at);

CREATE TABLE api_providers (
  id                 TEXT PRIMARY KEY,  -- uuid
  kind               TEXT NOT NULL CHECK (kind IN ('stt','translation','tts')),
  name               TEXT NOT NULL,
  provider_key       TEXT NOT NULL,     -- e.g. 'openai' | 'azure' | 'google' | 'elevenlabs'
  base_url           TEXT,
  model              TEXT,
  encrypted_api_key  BLOB,              -- opaque safeStorage output; never plaintext
  is_active          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_providers_kind_active ON api_providers(kind) WHERE is_active = 1;
