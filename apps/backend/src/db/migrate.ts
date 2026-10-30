import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './client';
import { childLogger } from '../logger';

const log = childLogger('db');
// Dev (tsx, real ESM) only has import.meta.url; the packaged tsup CJS bundle
// only has __dirname (esbuild injects it for CJS output, and warns that
// import.meta.url would be empty there — found by actually building and
// booting the bundle, not assumed). `typeof __dirname` is a safe check in
// both contexts — it never throws, even where __dirname was never declared.
const currentDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(currentDir, 'migrations');

/**
 * SQLite's `PRAGMA foreign_keys` is a documented no-op while a transaction
 * is active, so a migration that needs to toggle it (the recreate-table
 * CHECK-widening pattern used since 0003) can't be wrapped in a blanket
 * `db.transaction()` around the whole file — it would silently fail to
 * actually disable FK enforcement. Migrations that don't need to toggle FKs
 * get real atomicity here (a failure partway through no longer leaves the
 * DB with some tables created and `user_version` unbumped — the same file
 * would just fail identically and forever on next boot before this fix).
 * A migration that DOES need `PRAGMA foreign_keys=OFF/ON` must wrap its own
 * statement body in `BEGIN TRANSACTION;`/`COMMIT;` around just the
 * statements between the toggle (SQLite's own documented pattern for this)
 * if it wants the same atomicity — none of the 5 existing ones do yet, left
 * as-is rather than retroactively edited, since they're already applied on
 * every existing dev/deployed DB and the risk they've ever failed partway
 * is effectively zero at this point.
 */
function applyMigrationFile(sql: string, version: number): void {
  if (sql.includes('PRAGMA foreign_keys')) {
    db.exec(sql);
    db.pragma(`user_version = ${version}`);
    return;
  }
  db.transaction(() => {
    db.exec(sql);
    db.pragma(`user_version = ${version}`);
  })();
}

export function migrate() {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0] ?? '0', 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    applyMigrationFile(sql, version);
    appliedCount += 1;
    log.info({ file, version }, 'applied migration');
  }

  const finalVersion = db.pragma('user_version', { simple: true }) as number;
  log.info({ version: finalVersion, appliedCount }, 'db migrated');
}
