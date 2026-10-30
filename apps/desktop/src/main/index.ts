import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { logger } from './logger';
import { registerIpcHandlers } from './ipcHandlers';
import { startBackend, stopBackend } from './backendProcess';
import { loadWindowBounds, trackWindowBounds } from './windowState';
import { registerGlobalShortcuts, setupDisplayMediaHandler, unregisterGlobalShortcuts } from './audioIpc';
import { closeMiniWindow, setMainWindowGetter } from './miniWindow';
import { scrubForLog } from './logScrub';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0d0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  trackWindowBounds(mainWindow);

  // toggleMiniWindow() now hides/shows rather than destroys — if it were
  // left open+hidden, closing just this window would leave a phantom
  // BrowserWindow alive (getAllWindows() counts hidden windows too), so
  // window-all-closed would never fire and the app/backend would never
  // quit (no Tray in this app to recover from that). Force-destroy the
  // mini window whenever the main window actually closes.
  mainWindow.on('closed', () => closeMiniWindow());

  mainWindow.on('ready-to-show', () => {
    logger.info('main window ready-to-show');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('renderer did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error(`renderer did-fail-load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    logger.info(`[renderer console] ${level}: ${scrubForLog(message)}`);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  logger.info('app ready — starting backend and creating window');
  registerIpcHandlers();
  setupDisplayMediaHandler(session.defaultSession);
  await startBackend();
  createWindow();
  setMainWindowGetter(() => mainWindow);

  registerGlobalShortcuts(
    () => mainWindow,
    (action) => mainWindow?.webContents.send('shortcut:trigger', action),
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  unregisterGlobalShortcuts();
});

app.on('before-quit', () => {
  logger.info('quitting — stopping backend');
  stopBackend();
});
