import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config';
import { childLogger } from '../logger';

const log = childLogger('db');

const dbPath = resolve(config.BACKEND_DB_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

let dbHandle: Database.Database;
try {
  dbHandle = new Database(dbPath);
} catch (error) {
  // A disk-full/permissions/corrupt-file failure here would otherwise
  // surface as an opaque native-module stack trace with no actionable
  // guidance — fail loudly with a clear message instead of guessing at
  // recovery (matches this repo's "never silently delete user data" rule).
  log.fatal({ err: error, dbPath }, 'could not open the database file — the backend cannot start');
  process.exit(1);
}
export const db = dbHandle;
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Was previously unset (defaults to 0 — SQLITE_BUSY throws immediately on
// any lock contention instead of retrying). Low real risk for this
// single-process app, but cheap hardening against a stray concurrent access.
db.pragma('busy_timeout = 5000');
