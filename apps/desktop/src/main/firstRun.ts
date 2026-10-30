import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** Phase 15: persisted flag file, mirroring miniWindowState.ts's exact
 * pattern — a JSON file in userData, best-effort write, defaults to
 * "not completed" if the file is missing/unreadable (a fresh install). */
const FLAG_FILE = () => join(app.getPath('userData'), 'first-run-complete.json');

export function hasCompletedFirstRun(): boolean {
  try {
    const raw = readFileSync(FLAG_FILE(), 'utf-8');
    return JSON.parse(raw)?.completed === true;
  } catch {
    return false;
  }
}

export function markFirstRunComplete(): void {
  try {
    writeFileSync(FLAG_FILE(), JSON.stringify({ completed: true }));
  } catch {
    // best-effort only, same as miniWindowState.ts's saveMiniWindowState
  }
}

/** Backs Settings' "Redo Setup Wizard" button. */
export function resetFirstRun(): void {
  try {
    writeFileSync(FLAG_FILE(), JSON.stringify({ completed: false }));
  } catch {
    // best-effort only
  }
}
