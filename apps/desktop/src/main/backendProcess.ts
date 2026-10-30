import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { app } from 'electron';
import { logger } from './logger';
import { BACKEND_WS_TOKEN } from './backendAuth';

const BACKEND_WS_PORT = Number(process.env.VITE_BACKEND_WS_PORT ?? 4319);
const READINESS_POLL_INTERVAL_MS = 500;
const READINESS_MAX_ATTEMPTS = 20;
const RESTART_MAX_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE_MS = 1_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3_000;

const repoRootPath = resolve(app.getAppPath(), '..', '..');

let child: ChildProcess | null = null;
let restartAttempts = 0;
let shuttingDown = false;

export type BackendStatus = 'starting' | 'ready' | 'crashed' | 'stopped';
type StatusListener = (status: BackendStatus, message?: string) => void;
const statusListeners = new Set<StatusListener>();

export function onBackendStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function emitStatus(status: BackendStatus, message?: string) {
  for (const listener of statusListeners) listener(status, message);
}

/** Phase 15: a packaged build has no pnpm/tsx toolchain — it spawns the
 * app's own Electron binary in Node-mode (ELECTRON_RUN_AS_NODE) against the
 * pre-bundled backend under `extraResources`, rather than `pnpm run dev`.
 * Verified for real (not assumed): the tsup bundle's better-sqlite3 native
 * binding loads and a real DB round-trips fine under ELECTRON_RUN_AS_NODE —
 * it's built on N-API, ABI-stable across Node/Electron, no @electron/rebuild
 * needed. NODE_ENV=production is required (pino-pretty's worker-thread
 * transport only activates outside production and would otherwise try to
 * resolve a module path that doesn't exist inside a single-file bundle);
 * BACKEND_DB_PATH must point at userData, since the packaged install
 * directory isn't guaranteed writable and has no `data/` folder at all. */
function spawnBackend(): ChildProcess {
  if (app.isPackaged) {
    logger.info('[backend] spawning packaged backend via ELECTRON_RUN_AS_NODE');
    const backendEntry = join(process.resourcesPath, 'backend', 'index.cjs');
    const proc = spawn(process.execPath, [backendEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        BACKEND_WS_PORT: String(BACKEND_WS_PORT),
        BACKEND_WS_TOKEN,
        BACKEND_DB_PATH: join(app.getPath('userData'), 'kvl.sqlite3'),
      },
    });
    wireBackendProcess(proc);
    return proc;
  }

  logger.info('[backend] spawning dev backend via pnpm workspace filter');
  const proc = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', '@kvl/backend', 'run', 'dev'], {
    cwd: repoRootPath,
    // dotenv (loaded inside the backend via `import 'dotenv/config'`) never
    // overrides an already-set process.env value, so this always wins over
    // whatever apps/backend/.env has for BACKEND_WS_TOKEN.
    env: { ...process.env, BACKEND_WS_PORT: String(BACKEND_WS_PORT), BACKEND_WS_TOKEN },
    // pnpm → sh → tsx watch → node: killing only the pnpm pid leaves the rest
    // alive holding the port. A detached child leads its own process group so
    // stopBackend() can signal the whole tree.
    detached: process.platform !== 'win32',
  });
  wireBackendProcess(proc);
  return proc;
}

function signalBackend(proc: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    // group already gone
  }
}

function wireBackendProcess(proc: ChildProcess): void {
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      logger.info(`[backend] ${line}`);
    }
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      logger.warn(`[backend] ${line}`);
    }
  });

  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    logger.error(`[backend] exited unexpectedly (code=${code}, signal=${signal})`);
    emitStatus('crashed', `Backend process exited (code=${code})`);

    if (restartAttempts >= RESTART_MAX_ATTEMPTS) {
      logger.error('[backend] max restart attempts reached, giving up');
      return;
    }
    restartAttempts += 1;
    const delay = RESTART_BACKOFF_BASE_MS * 2 ** (restartAttempts - 1);
    logger.info(`[backend] restarting in ${delay}ms (attempt ${restartAttempts}/${RESTART_MAX_ATTEMPTS})`);
    setTimeout(() => {
      child = spawnBackend();
      void waitUntilReady();
    }, delay);
  });
}

async function waitUntilReady(): Promise<boolean> {
  emitStatus('starting');
  for (let attempt = 0; attempt < READINESS_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Must include the token now that the backend's verifyClient rejects
      // unauthenticated upgrade requests — without this the readiness probe
      // would always see 'error' and report the backend as never starting.
      const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_WS_PORT}?token=${BACKEND_WS_TOKEN}`);
      const opened = await new Promise<boolean>((resolvePromise) => {
        ws.addEventListener('open', () => resolvePromise(true), { once: true });
        ws.addEventListener('error', () => resolvePromise(false), { once: true });
      });
      ws.close();
      if (opened) {
        restartAttempts = 0;
        emitStatus('ready');
        return true;
      }
    } catch {
      // fall through to retry
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS));
  }
  logger.error('[backend] did not become ready in time');
  emitStatus('crashed', 'Backend did not start in time');
  return false;
}

export async function startBackend(): Promise<boolean> {
  child = spawnBackend();
  return waitUntilReady();
}

export function stopBackend(): void {
  if (!child) return;
  shuttingDown = true;
  const proc = child;
  signalBackend(proc, 'SIGTERM');
  // proc.killed is true as soon as a signal is sent, so check exit state instead.
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) signalBackend(proc, 'SIGKILL');
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS).unref();
  child = null;
  emitStatus('stopped');
}
