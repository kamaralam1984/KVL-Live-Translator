import { type BrowserWindow, desktopCapturer, globalShortcut, ipcMain, type Session } from 'electron';
import { logger } from './logger';
import { toggleMiniWindow, setMiniAlwaysOnTop, setMiniInteractive, setMiniMode, getMiniWindowState } from './miniWindow';
import type { MiniWindowMode } from './miniWindowState';

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  startCapture: 'Alt+Shift+S',
  pauseCapture: 'Alt+Shift+P',
  stopCapture: 'Alt+Shift+X',
  muteMicrophone: 'Alt+Shift+M',
  toggleWindow: 'Alt+Shift+K',
  // Phase 12 additions — window-level actions (handled directly below, same
  // special-casing pattern as toggleWindow, since they're BrowserWindow
  // method calls, not renderer state).
  toggleMiniWindow: 'Alt+Shift+T',
  toggleAlwaysOnTop: 'Alt+Shift+O',
  toggleInteraction: 'Alt+Shift+I', // the only reliable way to restore interaction once click-through is on
  cycleMiniMode: 'Alt+Shift+C',
  // Phase 12 additions — renderer-state actions, routed through onTrigger()
  // to the main window (see wsClient.ts/App.tsx's onShortcut listener).
  toggleTranslationPause: 'Alt+Shift+G',
  toggleResponsePanel: 'Alt+Shift+V',
};

const MODE_CYCLE: MiniWindowMode[] = ['full', 'compact', 'mini', 'collapsed'];

export function registerAudioIpcHandlers(): void {
  ipcMain.handle('audio:get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: false });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('system:get-platform', () => process.platform);

  ipcMain.handle('system:get-resource-usage', () => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system };
  });
}

/**
 * `getDisplayMedia()` in the renderer rejects unless the main process
 * supplies this handler. We auto-select the primary screen and request
 * loopback audio — Electron's documented mechanism for Windows/some-Linux
 * system-audio capture (see SystemAudioCapture.ts for the runtime
 * audio-track-present check on the renderer side, since loopback audio
 * silently isn't available on macOS and some Linux configs).
 */
export function setupDisplayMediaHandler(session: Session): void {
  session.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const primary = sources[0];
    if (!primary) {
      callback({});
      return;
    }
    callback({ video: primary, audio: 'loopback' });
  });
}

export function registerGlobalShortcuts(getWindow: () => BrowserWindow | null, onTrigger: (action: string) => void): void {
  for (const [action, accelerator] of Object.entries(DEFAULT_SHORTCUTS)) {
    const ok = globalShortcut.register(accelerator, () => {
      switch (action) {
        case 'toggleWindow': {
          const win = getWindow();
          if (!win) return;
          if (win.isVisible()) win.hide();
          else win.show();
          return;
        }
        case 'toggleMiniWindow':
          void toggleMiniWindow();
          return;
        case 'toggleAlwaysOnTop':
          setMiniAlwaysOnTop(!getMiniWindowState().alwaysOnTop);
          return;
        case 'toggleInteraction':
          setMiniInteractive(!getMiniWindowState().interactive);
          return;
        case 'cycleMiniMode': {
          const current = getMiniWindowState().mode;
          const next = MODE_CYCLE[(MODE_CYCLE.indexOf(current) + 1) % MODE_CYCLE.length];
          setMiniMode(next);
          return;
        }
        default:
          onTrigger(action);
      }
    });
    if (!ok) logger.warn(`failed to register global shortcut "${accelerator}" for "${action}"`);
  }
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}
