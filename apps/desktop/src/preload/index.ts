import { contextBridge, ipcRenderer } from 'electron';
import type { MiniWindowMode, DisplayPreference, MiniWindowState } from '../main/miniWindowState';

export interface DesktopSourceInfo {
  id: string;
  name: string;
}

export interface MiniWindowStateDTO extends MiniWindowState {
  isOpen: boolean;
  isVisible: boolean;
}

export interface DisplayOption {
  id: number;
  label: string;
  isPrimary: boolean;
}

export interface ResourceUsage {
  rssBytes: number;
  heapUsedBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface BackendConnectionInfo {
  port: number;
  /** Phase 13 — required to open the backend WS connection at all now that
   * the server rejects unauthenticated upgrade requests. */
  token: string;
}

export interface AppVersions {
  electron: string;
  chrome: string;
  node: string;
}

export type UpdateStatus = 'checking' | 'up-to-date' | 'update-available' | 'error';

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  message?: string;
}

const kvlAPI = {
  isEncryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke('secure-storage:is-available'),
  encryptSecret: (plainText: string): Promise<string> => ipcRenderer.invoke('secure-storage:encrypt', plainText),
  decryptSecret: (encryptedBase64: string): Promise<string> => ipcRenderer.invoke('secure-storage:decrypt', encryptedBase64),
  getConnectionInfo: (): Promise<BackendConnectionInfo> => ipcRenderer.invoke('backend:get-connection-info'),

  getDesktopSources: (): Promise<DesktopSourceInfo[]> => ipcRenderer.invoke('audio:get-desktop-sources'),
  /** Returns process.platform as a plain string ('darwin'/'linux'/'win32'/...) — kept
   * untyped as NodeJS.Platform here so this file's exported type doesn't require
   * @types/node in the renderer's tsconfig, which intentionally excludes it. */
  getPlatform: (): Promise<string> => ipcRenderer.invoke('system:get-platform'),
  getResourceUsage: (): Promise<ResourceUsage> => ipcRenderer.invoke('system:get-resource-usage'),
  onShortcut: (listener: (action: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => listener(action);
    ipcRenderer.on('shortcut:trigger', handler);
    return () => ipcRenderer.removeListener('shortcut:trigger', handler);
  },

  /** First call creates+shows the floating mini window; later calls
   * hide/show it (not destroy — its state/WS connection stays alive). */
  toggleMiniWindow: (): Promise<void> => ipcRenderer.invoke('window:toggle-mini'),
  setMiniMode: (mode: MiniWindowMode): Promise<void> => ipcRenderer.invoke('window:mini-set-mode', mode),
  setMiniAlwaysOnTop: (alwaysOnTop: boolean): Promise<void> => ipcRenderer.invoke('window:mini-set-always-on-top', alwaysOnTop),
  setMiniOpacity: (opacity: number): Promise<void> => ipcRenderer.invoke('window:mini-set-opacity', opacity),
  /** false = click-through enabled. The only reliable way back is the
   * Alt+Shift+I global shortcut — nothing inside the window is clickable
   * once this is off. */
  setMiniInteractive: (interactive: boolean): Promise<void> => ipcRenderer.invoke('window:mini-set-interactive', interactive),
  setMiniDisplay: (preference: DisplayPreference): Promise<void> => ipcRenderer.invoke('window:mini-set-display', preference),
  resetMiniPosition: (): Promise<void> => ipcRenderer.invoke('window:mini-reset-position'),
  resetMiniSize: (): Promise<void> => ipcRenderer.invoke('window:mini-reset-size'),
  getMiniWindowState: (): Promise<MiniWindowStateDTO> => ipcRenderer.invoke('window:mini-get-state'),
  getMiniWindowDisplays: (): Promise<DisplayOption[]> => ipcRenderer.invoke('window:mini-get-displays'),

  /** Native save dialog + write — TXT/Markdown/JSON exports. Returns false
   * if the user cancels the dialog. */
  saveTextFile: (content: string, suggestedName: string, filters: FileFilter[]): Promise<boolean> =>
    ipcRenderer.invoke('file:save-text', content, suggestedName, filters),
  /** Real PDF via Electron's native printToPDF() on a hidden window — html
   * is a small, self-contained print-styled document, not a live page. */
  exportSummaryPdf: (html: string, suggestedName: string): Promise<boolean> => ipcRenderer.invoke('file:export-pdf', html, suggestedName),

  /** Phase 15 first-run setup wizard. */
  getFirstRunStatus: (): Promise<boolean> => ipcRenderer.invoke('first-run:get-status'),
  markFirstRunComplete: (): Promise<void> => ipcRenderer.invoke('first-run:mark-complete'),
  resetFirstRun: (): Promise<void> => ipcRenderer.invoke('first-run:reset'),
  getDefaultShortcuts: (): Promise<Record<string, string>> => ipcRenderer.invoke('shortcuts:get-defaults'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getAppVersions: (): Promise<AppVersions> => ipcRenderer.invoke('app:get-versions'),
  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('update:check'),
};

export type KvlAPI = typeof kvlAPI;

contextBridge.exposeInMainWorld('kvlAPI', kvlAPI);
