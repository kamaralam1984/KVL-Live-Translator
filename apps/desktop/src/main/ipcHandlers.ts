import { app, ipcMain } from 'electron';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secureStorage';
import { registerAudioIpcHandlers, DEFAULT_SHORTCUTS } from './audioIpc';
import { hasCompletedFirstRun, markFirstRunComplete, resetFirstRun } from './firstRun';
import { checkForUpdate } from './updateCheck';
import {
  toggleMiniWindow,
  setMiniMode,
  setMiniAlwaysOnTop,
  setMiniOpacity,
  setMiniInteractive,
  setMiniDisplay,
  resetMiniPosition,
  resetMiniSize,
  getMiniWindowState,
  getAvailableDisplays,
} from './miniWindow';
import { saveTextFile, exportSummaryPdf } from './fileExport';
import { BACKEND_WS_TOKEN } from './backendAuth';
import { assertString, assertSafeFilename, assertBoolean, assertNumberInRange, assertEnum, assertFileFilters } from './ipcValidation';

const BACKEND_WS_PORT = Number(process.env.VITE_BACKEND_WS_PORT ?? 4319);
const MINI_MODES = ['full', 'compact', 'mini', 'collapsed'] as const;
const DISPLAY_PREFERENCES = ['primary', 'secondary', 'current'] as const;

export function registerIpcHandlers(): void {
  ipcMain.handle('secure-storage:is-available', () => isEncryptionAvailable());
  ipcMain.handle('secure-storage:encrypt', (_event, plainText: unknown) => encryptSecret(assertString(plainText, 'plainText', 10_000)));
  ipcMain.handle('secure-storage:decrypt', (_event, encryptedBase64: unknown) => decryptSecret(assertString(encryptedBase64, 'encryptedBase64', 10_000)));
  // Phase 13: a shared secret alongside the port, checked by the backend's
  // WS verifyClient — closes the gap where any local process/webpage could
  // open ws://127.0.0.1:<port> and read live meeting broadcasts.
  ipcMain.handle('backend:get-connection-info', () => ({ port: BACKEND_WS_PORT, token: BACKEND_WS_TOKEN }));
  ipcMain.handle('window:toggle-mini', () => toggleMiniWindow());
  ipcMain.handle('window:mini-set-mode', (_event, mode: unknown) => setMiniMode(assertEnum(mode, 'mode', MINI_MODES)));
  ipcMain.handle('window:mini-set-always-on-top', (_event, alwaysOnTop: unknown) => setMiniAlwaysOnTop(assertBoolean(alwaysOnTop, 'alwaysOnTop')));
  ipcMain.handle('window:mini-set-opacity', (_event, opacity: unknown) => setMiniOpacity(assertNumberInRange(opacity, 'opacity', 0, 1)));
  ipcMain.handle('window:mini-set-interactive', (_event, interactive: unknown) => setMiniInteractive(assertBoolean(interactive, 'interactive')));
  ipcMain.handle('window:mini-set-display', (_event, preference: unknown) => setMiniDisplay(assertEnum(preference, 'preference', DISPLAY_PREFERENCES)));
  ipcMain.handle('window:mini-reset-position', () => resetMiniPosition());
  ipcMain.handle('window:mini-reset-size', () => resetMiniSize());
  ipcMain.handle('window:mini-get-state', () => getMiniWindowState());
  ipcMain.handle('window:mini-get-displays', () => getAvailableDisplays());
  ipcMain.handle('file:save-text', (_event, content: unknown, suggestedName: unknown, filters: unknown) =>
    saveTextFile(assertString(content, 'content'), assertSafeFilename(suggestedName, 'suggestedName'), assertFileFilters(filters, 'filters')),
  );
  ipcMain.handle('file:export-pdf', (_event, html: unknown, suggestedName: unknown) => exportSummaryPdf(assertString(html, 'html'), assertSafeFilename(suggestedName, 'suggestedName')));

  // Phase 15
  ipcMain.handle('first-run:get-status', () => hasCompletedFirstRun());
  ipcMain.handle('first-run:mark-complete', () => markFirstRunComplete());
  ipcMain.handle('first-run:reset', () => resetFirstRun());
  ipcMain.handle('shortcuts:get-defaults', () => DEFAULT_SHORTCUTS);
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-versions', () => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }));
  ipcMain.handle('update:check', () => checkForUpdate());

  registerAudioIpcHandlers();
}
