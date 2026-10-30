import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { MODE_DIMENSIONS, type DisplayPreference, type MiniWindowMode } from './miniWindowGeometry';

export type { Rect, DisplayInfo, MiniWindowMode, DisplayPreference } from './miniWindowGeometry';
export { dimensionsForMode, clampToVisibleArea, pickDisplay, MODE_DIMENSIONS } from './miniWindowGeometry';

export interface MiniWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  opacity: number;
  interactive: boolean;
  displayPreference: DisplayPreference;
  mode: MiniWindowMode;
}

const DEFAULT_STATE: MiniWindowState = {
  width: MODE_DIMENSIONS.compact.width,
  height: MODE_DIMENSIONS.compact.height,
  alwaysOnTop: false, // spec: "Do not force always-on-top"
  opacity: 1,
  interactive: true, // spec: "Do NOT enable click-through by default"
  displayPreference: 'primary',
  mode: 'compact', // today's existing default size/shape
};

const STATE_FILE = () => join(app.getPath('userData'), 'mini-window-state.json');

export function loadMiniWindowState(): MiniWindowState {
  try {
    const raw = readFileSync(STATE_FILE(), 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveMiniWindowState(state: MiniWindowState): void {
  try {
    writeFileSync(STATE_FILE(), JSON.stringify(state));
  } catch {
    // best-effort only, same as windowState.ts
  }
}
