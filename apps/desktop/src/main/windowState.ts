import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, type Rectangle } from 'electron';

const STATE_FILE = () => join(app.getPath('userData'), 'window-state.json');

const DEFAULT_BOUNDS: Rectangle = { x: 0, y: 0, width: 1280, height: 800 };

export function loadWindowBounds(): Rectangle {
  try {
    const raw = readFileSync(STATE_FILE(), 'utf-8');
    return { ...DEFAULT_BOUNDS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_BOUNDS;
  }
}

export function trackWindowBounds(win: BrowserWindow): void {
  const persist = () => {
    try {
      writeFileSync(STATE_FILE(), JSON.stringify(win.getBounds()));
    } catch {
      // best-effort only
    }
  };
  win.on('resize', persist);
  win.on('move', persist);
}
