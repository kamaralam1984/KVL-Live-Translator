import { join } from 'node:path';
import { app, BrowserWindow, screen, type Display } from 'electron';
import { logger } from './logger';
import {
  loadMiniWindowState,
  saveMiniWindowState,
  clampToVisibleArea,
  dimensionsForMode,
  pickDisplay,
  type MiniWindowState,
  type DisplayInfo,
  type DisplayPreference,
  type MiniWindowMode,
  type Rect,
} from './miniWindowState';

const MINI_MARGIN = 24;

let miniWindow: BrowserWindow | null = null;
let state: MiniWindowState = loadMiniWindowState();
let getMainWindow: (() => BrowserWindow | null) | null = null;

/** Called once at app boot (index.ts) so this module can resolve the main
 * window's current display ('current' display preference) and hook its own
 * `closed` cleanup, without a circular import between index.ts and this
 * file (index.ts imports FROM here, never the reverse). */
export function setMainWindowGetter(getter: () => BrowserWindow | null): void {
  getMainWindow = getter;
}

function toDisplayInfo(display: Display, primaryId: number): DisplayInfo {
  return { id: display.id, bounds: display.bounds, workArea: display.workArea, isPrimary: display.id === primaryId };
}

function getDisplayInfos(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => toDisplayInfo(d, primaryId));
}

function currentMainWindowDisplayId(): number | undefined {
  const main = getMainWindow?.();
  if (!main || main.isDestroyed()) return undefined;
  return screen.getDisplayMatching(main.getBounds()).id;
}

function defaultPosition(width: number, height: number, displays: DisplayInfo[], preference: DisplayPreference): Rect {
  const target = pickDisplay(displays, preference, currentMainWindowDisplayId());
  return {
    x: target.workArea.x + target.workArea.width - width - MINI_MARGIN,
    y: target.workArea.y + MINI_MARGIN,
    width,
    height,
  };
}

function buildInitialBounds(): Rect {
  const displays = getDisplayInfos();
  const dims = dimensionsForMode(state.mode);
  const bounds: Rect =
    state.x !== undefined && state.y !== undefined
      ? { x: state.x, y: state.y, width: dims.width, height: dims.height }
      : defaultPosition(dims.width, dims.height, displays, state.displayPreference);
  return clampToVisibleArea(bounds, displays);
}

function persistBounds(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const b = miniWindow.getBounds();
  state = { ...state, x: b.x, y: b.y, width: b.width, height: b.height };
  saveMiniWindowState(state);
}

function createMiniWindow(): void {
  const bounds = buildInitialBounds();
  const isCollapsed = state.mode === 'collapsed';

  miniWindow = new BrowserWindow({
    ...bounds,
    minWidth: isCollapsed ? bounds.width : 300,
    minHeight: isCollapsed ? bounds.height : 360,
    resizable: !isCollapsed,
    frame: !isCollapsed, // native frame gives drag/resize "for free" for full/compact/mini;
    // collapsed goes frameless — a native titlebar at 64x64 would be non-functional on most
    // platforms (Linux GTK/Windows titlebar chrome alone can approach or exceed that size).
    title: 'KVL Live Translator — Mini',
    autoHideMenuBar: true,
    alwaysOnTop: state.alwaysOnTop,
    opacity: state.opacity,
    backgroundColor: '#0c0d0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  if (!state.interactive) miniWindow.setIgnoreMouseEvents(true, { forward: true });

  miniWindow.on('closed', () => {
    miniWindow = null;
  });
  miniWindow.on('resize', persistBounds);
  miniWindow.on('move', persistBounds);

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/mini`);
  } else {
    void miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/mini' });
  }

  miniWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error(`mini window did-fail-load: ${errorCode} ${errorDescription}`);
  });
}

/**
 * A genuine second BrowserWindow loading the same renderer bundle, routed
 * to /mini (no sidebar — see router.tsx). First call creates+shows it
 * (applying persisted mode/bounds/always-on-top/opacity/interactive); later
 * calls hide/show rather than destroy/recreate — "quickly hide/show" per
 * the Phase 12 spec, and it keeps the window's WS connection/state alive
 * across toggles instead of re-establishing it every time.
 */
export async function toggleMiniWindow(): Promise<void> {
  if (miniWindow && !miniWindow.isDestroyed()) {
    if (miniWindow.isVisible()) miniWindow.hide();
    else miniWindow.show();
    return;
  }
  createMiniWindow();
}

/** Force-destroys (not hide) — used when the app is actually quitting
 * (index.ts hooks mainWindow's 'closed' event to this) so a hidden mini
 * window left open doesn't prevent 'window-all-closed' from ever firing
 * (that handler only counts destroyed windows, and getAllWindows() still
 * counts a merely-hidden one — this repo has no Tray to recover from that). */
export function closeMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy();
}

/** `frame` is a BrowserWindow construction-time-only property in Electron —
 * transitions into/out of 'collapsed' recreate the window; all other mode
 * changes just resize in place. */
export function setMiniMode(mode: MiniWindowMode): void {
  const previousMode = state.mode;
  const dims = dimensionsForMode(mode);
  state = { ...state, mode, width: dims.width, height: dims.height };
  saveMiniWindowState(state);

  if (!miniWindow || miniWindow.isDestroyed()) return;

  const frameChanged = (previousMode === 'collapsed') !== (mode === 'collapsed');
  if (frameChanged) {
    const wasVisible = miniWindow.isVisible();
    miniWindow.destroy();
    createMiniWindow();
    if (!wasVisible) miniWindow?.hide();
    return;
  }

  const current = miniWindow.getBounds();
  const clamped = clampToVisibleArea({ x: current.x, y: current.y, width: dims.width, height: dims.height }, getDisplayInfos());
  miniWindow.setBounds(clamped);
}

export function setMiniAlwaysOnTop(alwaysOnTop: boolean): void {
  state = { ...state, alwaysOnTop };
  saveMiniWindowState(state);
  miniWindow?.setAlwaysOnTop(alwaysOnTop);
}

export function setMiniOpacity(opacity: number): void {
  const clamped = Math.min(1, Math.max(0.5, opacity));
  state = { ...state, opacity: clamped };
  saveMiniWindowState(state);
  // Known caveat, not silently swallowed: some Linux compositors/window
  // managers no-op setOpacity(). The setting is still saved and re-applied
  // on every window creation regardless, so it takes effect wherever
  // supported instead of being rejected outright.
  miniWindow?.setOpacity(clamped);
}

export function setMiniInteractive(interactive: boolean): void {
  state = { ...state, interactive };
  saveMiniWindowState(state);
  miniWindow?.setIgnoreMouseEvents(!interactive, { forward: true });
}

export function setMiniDisplay(preference: DisplayPreference): void {
  state = { ...state, displayPreference: preference, x: undefined, y: undefined };
  saveMiniWindowState(state);
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const displays = getDisplayInfos();
  const dims = dimensionsForMode(state.mode);
  const bounds = clampToVisibleArea(defaultPosition(dims.width, dims.height, displays, preference), displays);
  miniWindow.setBounds(bounds);
}

export function resetMiniPosition(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const displays = getDisplayInfos();
  const dims = dimensionsForMode(state.mode);
  const bounds = clampToVisibleArea(defaultPosition(dims.width, dims.height, displays, state.displayPreference), displays);
  miniWindow.setBounds(bounds);
}

export function resetMiniSize(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const dims = dimensionsForMode(state.mode);
  const current = miniWindow.getBounds();
  const clamped = clampToVisibleArea({ ...current, width: dims.width, height: dims.height }, getDisplayInfos());
  miniWindow.setBounds(clamped);
}

export function getMiniWindowState(): MiniWindowState & { isOpen: boolean; isVisible: boolean } {
  return {
    ...state,
    isOpen: Boolean(miniWindow && !miniWindow.isDestroyed()),
    isVisible: Boolean(miniWindow && miniWindow.isVisible()),
  };
}

export function getAvailableDisplays(): Array<{ id: number; label: string; isPrimary: boolean }> {
  return getDisplayInfos().map((d, i) => ({ id: d.id, label: d.isPrimary ? 'Primary display' : `Display ${i + 1}`, isPrimary: d.isPrimary }));
}

function handleDisplayChange(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const current = miniWindow.getBounds();
  const clamped = clampToVisibleArea(current, getDisplayInfos());
  if (clamped.x !== current.x || clamped.y !== current.y || clamped.width !== current.width || clamped.height !== current.height) {
    miniWindow.setBounds(clamped);
  }
}

// Registered ONCE, after app 'ready' (screen is unusable before that), not
// inside toggleMiniWindow()/createMiniWindow() — `screen` is a singleton
// system-wide EventEmitter, not scoped to a window instance, so registering
// per-window-creation would accumulate duplicate listeners across repeated
// open/close cycles. app.whenReady() resolves exactly once, so this still
// only registers once per app lifetime.
app.whenReady().then(() => {
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
});
