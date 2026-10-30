/**
 * Deliberately zero Electron import — every function here is pure and
 * directly unit-testable via `mini-window.node-test.ts` (plain `tsx`, no
 * Electron process needed). `miniWindow.ts` maps real Electron `Display`
 * objects (from `screen.getAllDisplays()`) into `DisplayInfo` before
 * calling these (Electron's `Display` already has `id`/`bounds`/`workArea`;
 * `isPrimary` isn't a native field, computed by comparing ids).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  isPrimary: boolean;
}

export type MiniWindowMode = 'full' | 'compact' | 'mini' | 'collapsed';
export type DisplayPreference = 'primary' | 'secondary' | 'current';

export const MODE_DIMENSIONS: Record<MiniWindowMode, { width: number; height: number }> = {
  full: { width: 480, height: 680 },
  compact: { width: 380, height: 540 }, // unchanged from Phase 5's MINI_WIDTH/MINI_HEIGHT
  mini: { width: 340, height: 160 },
  collapsed: { width: 64, height: 64 },
};

export function dimensionsForMode(mode: MiniWindowMode): { width: number; height: number } {
  return MODE_DIMENSIONS[mode];
}

function overlapArea(a: Rect, b: Rect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

/**
 * Never lets a window end up positioned outside every visible display. If
 * `bounds` already overlaps a display's work area, it's nudged fully inside
 * that display's work area (handles "partially off-screen"). If it overlaps
 * no display at all (e.g. the display it was on got unplugged), it's
 * re-centered on the primary display instead. Width/height are capped to
 * fit the chosen display's work area either way.
 */
export function clampToVisibleArea(bounds: Rect, displays: DisplayInfo[]): Rect {
  if (displays.length === 0) return bounds;

  let best = displays[0];
  let bestArea = -1;
  for (const d of displays) {
    const area = overlapArea(bounds, d.workArea);
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }

  if (bestArea <= 0) {
    best = displays.find((d) => d.isPrimary) ?? displays[0];
  }

  const wa = best.workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);

  if (bestArea <= 0) {
    return {
      x: wa.x + Math.round((wa.width - width) / 2),
      y: wa.y + Math.round((wa.height - height) / 2),
      width,
      height,
    };
  }

  return {
    x: Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - width),
    y: Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - height),
    width,
    height,
  };
}

/** 'secondary' falls back to primary when only one display exists. 'current'
 * matches whichever display contains `currentDisplayId` (the main window's
 * display), falling back to primary if that id isn't in `displays` (e.g. it
 * was just unplugged). Assumes `displays` is non-empty — true for any real
 * desktop session, which Electron itself guarantees. */
export function pickDisplay(displays: DisplayInfo[], preference: DisplayPreference, currentDisplayId?: number): DisplayInfo {
  const primary = displays.find((d) => d.isPrimary) ?? displays[0];
  if (preference === 'primary') return primary;
  if (preference === 'current') return displays.find((d) => d.id === currentDisplayId) ?? primary;
  return displays.find((d) => !d.isPrimary) ?? primary; // 'secondary'
}
