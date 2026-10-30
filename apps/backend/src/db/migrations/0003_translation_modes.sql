-- TranslationMode changed from ('formal'|'hinglish') to the Phase 4 four-mode
-- set. SQLite has no ALTER TABLE ... ALTER CHECK, so this recreates both
-- CHECK-constrained tables. translation_history FKs to meeting_sessions, so
-- foreign_keys is disabled for the duration (client.ts re-enables it after
-- every migration run completes, via a fresh connection on next start — but
-- to be safe this migration also re-enables it explicitly at the end).

PRAGMA foreign_keys = OFF;

CREATE TABLE meeting_sessions_new (
  id                 TEXT PRIMARY KEY,
  title              TEXT,
  mode               TEXT NOT NULL CHECK (mode IN ('hindi','hinglish','simple-hindi','simple-english')),
  started_at         TEXT NOT NULL,
  ended_at           TEXT,
  capture_mode       TEXT,
  audio_format       TEXT,
  mic_device_label   TEXT
);

INSERT INTO meeting_sessions_new (id, title, mode, started_at, ended_at, capture_mode, audio_format, mic_device_label)
SELECT id, title, CASE mode WHEN 'formal' THEN 'hindi' ELSE mode END, started_at, ended_at, capture_mode, audio_format, mic_device_label
FROM meeting_sessions;

DROP TABLE meeting_sessions;
ALTER TABLE meeting_sessions_new RENAME TO meeting_sessions;

CREATE TABLE translation_history_new (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  original_text   TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  suggested_reply TEXT,
  mode            TEXT NOT NULL CHECK (mode IN ('hindi','hinglish','simple-hindi','simple-english')),
  source_lang     TEXT NOT NULL,
  target_lang     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

INSERT INTO translation_history_new (id, session_id, original_text, translated_text, suggested_reply, mode, source_lang, target_lang, created_at)
SELECT id, session_id, original_text, translated_text, suggested_reply, CASE mode WHEN 'formal' THEN 'hindi' ELSE mode END, source_lang, target_lang, created_at
FROM translation_history;

DROP TABLE translation_history;
ALTER TABLE translation_history_new RENAME TO translation_history;

CREATE INDEX idx_history_session ON translation_history(session_id);
CREATE INDEX idx_history_created ON translation_history(created_at);

PRAGMA foreign_keys = ON;
