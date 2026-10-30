/**
 * Only Electron injects `window.kvlAPI` via the preload script. This stands in
 * for it when the renderer is opened directly in a plain browser (dev-only —
 * for visually checking screens without an Electron window), so components
 * don't crash on `window.kvlAPI.x is undefined`. Every method here is a
 * harmless no-op/false default, never a fake success.
 */
export function installBrowserKvlApiShimIfNeeded(): void {
  if (window.kvlAPI) return;

  console.warn('[kvl] window.kvlAPI not found — running outside Electron, using a browser-mode shim.');

  window.kvlAPI = {
    isEncryptionAvailable: async () => false,
    encryptSecret: async () => {
      throw new Error('Secure storage is only available inside the Electron app.');
    },
    decryptSecret: async () => {
      throw new Error('Secure storage is only available inside the Electron app.');
    },
    // Matches apps/backend/.env's BACKEND_WS_TOKEN dev-fallback value —
    // only works if the backend was started as a bare `pnpm dev` (no
    // Electron), which is the only way this shim path is ever reached.
    getConnectionInfo: async () => ({ port: 4319, token: '036145bae0ff7a40662bd187d81b81ff0c6578cba941d48a8bf021bf9d55e4bb' }),
    getDesktopSources: async () => [],
    getPlatform: async () => 'unknown',
    getResourceUsage: async () => ({
      rssBytes: 0,
      heapUsedBytes: 0,
      cpuUserMicros: 0,
      cpuSystemMicros: 0,
    }),
    onShortcut: () => () => {},
    toggleMiniWindow: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    setMiniMode: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    setMiniAlwaysOnTop: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    setMiniOpacity: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    setMiniInteractive: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    setMiniDisplay: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    resetMiniPosition: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    resetMiniSize: async () => {
      console.warn('[kvl] the floating mini window is only available inside the Electron app.');
    },
    getMiniWindowState: async () => ({
      width: 380,
      height: 540,
      alwaysOnTop: false,
      opacity: 1,
      interactive: true,
      displayPreference: 'primary' as const,
      mode: 'compact' as const,
      isOpen: false,
      isVisible: false,
    }),
    getMiniWindowDisplays: async () => [],
    saveTextFile: async () => {
      console.warn('[kvl] file export is only available inside the Electron app.');
      return false;
    },
    exportSummaryPdf: async () => {
      console.warn('[kvl] PDF export is only available inside the Electron app.');
      return false;
    },
    // Browser-mode dev preview never gates on first-run — treat it as
    // already-completed so the wizard doesn't block navigating around freely.
    getFirstRunStatus: async () => true,
    markFirstRunComplete: async () => {},
    resetFirstRun: async () => {},
    getDefaultShortcuts: async () => ({}),
    getAppVersion: async () => '0.0.0-browser-preview',
    getAppVersions: async () => ({ electron: 'n/a', chrome: 'n/a', node: 'n/a' }),
    checkForUpdate: async () => ({ status: 'error' as const, currentVersion: '0.0.0-browser-preview', message: 'Update checks are only available inside the Electron app.' }),
  };
}
