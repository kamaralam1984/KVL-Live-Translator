import { randomBytes } from 'node:crypto';

/**
 * One 256-bit token generated per app launch, in-memory only — never
 * written to disk, never logged. Passed to the spawned backend child as the
 * BACKEND_WS_TOKEN env var (backendProcess.ts) and to the renderer via IPC
 * (ipcHandlers.ts's window:get-connection-info) so only this app's own
 * windows can open a WebSocket to the backend — closes a real gap where any
 * local process/webpage could otherwise connect and read live meeting
 * broadcasts (see apps/backend/src/ws/server.ts's verifyClient).
 */
export const BACKEND_WS_TOKEN: string = randomBytes(32).toString('hex');
