import type { WebSocket, WebSocketServer } from 'ws';
import { childLogger } from '../logger';

const log = childLogger('ws-heartbeat');
const PING_INTERVAL_MS = 15_000;

interface HeartbeatState {
  isAlive: boolean;
}

const state = new WeakMap<WebSocket, HeartbeatState>();

/**
 * Native WS-frame-level liveness check (distinct from the app-level
 * ping/pong JSON messages the renderer sends, which are just for the UI's
 * connection-status pill). This reaps sockets that silently died (e.g. the
 * OS dropped the connection) without a clean close event ever firing.
 */
export function trackConnection(ws: WebSocket): void {
  state.set(ws, { isAlive: true });
  ws.on('pong', () => {
    const entry = state.get(ws);
    if (entry) entry.isAlive = true;
  });
}

export function startHeartbeatSweep(wss: WebSocketServer): NodeJS.Timeout {
  return setInterval(() => {
    for (const ws of wss.clients) {
      const entry = state.get(ws);
      if (!entry) continue;
      if (!entry.isAlive) {
        log.warn('terminating stale connection');
        ws.terminate();
        continue;
      }
      entry.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);
}
