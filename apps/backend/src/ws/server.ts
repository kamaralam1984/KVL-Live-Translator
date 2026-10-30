import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@kvl/shared';
import { config } from '../config';
import { childLogger } from '../logger';
import { trackConnection, startHeartbeatSweep } from './heartbeat';
import { handleClientMessage, handleError, type Send } from './protocolHandlers';
import { register, unregister } from './connectionRegistry';
import { WsRateLimiter } from './WsRateLimiter';

const log = childLogger('ws-server');
const HELLO_TIMEOUT_MS = 5_000;
// Documented, bounded value — the largest legitimate payload is a base64-
// encoded PCM16 audio chunk (a few seconds of audio), nowhere near this.
// Was previously unset, defaulting to the `ws` library's own 100MB default.
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
// Generous for main window + mini window + any future diagnostics window,
// while still bounding a runaway-reconnect-loop bug or a local flood.
const MAX_CONNECTIONS = 10;

/** Constant-time comparison regardless of input length — hashing both sides
 * to a fixed-size digest first means a mismatched-length guess never even
 * produces a length-based timing signal, not just a value-based one. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function startWsServer(): WebSocketServer {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: config.BACKEND_WS_PORT,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Runs at the HTTP-upgrade layer, BEFORE 'connection' (and therefore
    // before register()) ever fires — closes the real, previously-
    // exploitable gap where an unauthenticated socket got subscribed to
    // every live broadcast during the 5s hello-timeout window, without
    // ever needing to send a valid message. Any local process, or any
    // webpage open in any local browser tab (WebSocket connections are
    // exempt from the Same-Origin Policy), could otherwise just open
    // ws://127.0.0.1:<port> and read live meeting content.
    verifyClient: (info, callback) => {
      if (wss.clients.size >= MAX_CONNECTIONS) {
        log.warn({ current: wss.clients.size }, 'rejecting connection: MAX_CONNECTIONS reached');
        callback(false, 503, 'Too many connections');
        return;
      }

      const url = new URL(info.req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const ok = typeof token === 'string' && token.length > 0 && tokensMatch(token, config.BACKEND_WS_TOKEN);
      if (!ok) {
        log.warn('rejecting connection: invalid or missing auth token');
        callback(false, 401, 'Unauthorized');
        return;
      }
      callback(true);
    },
  });

  wss.on('connection', (ws: WebSocket) => {
    trackConnection(ws);
    log.info('client connected');

    let receivedHello = false;
    const helloTimeout = setTimeout(() => {
      if (!receivedHello) {
        log.warn('closing connection: no hello received in time');
        ws.close(4000, 'hello timeout');
      }
    }, HELLO_TIMEOUT_MS);

    const send: Send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    register(send);

    const rateLimiter = new WsRateLimiter();

    ws.on('message', (raw) => {
      if (!rateLimiter.recordAndCheck()) {
        log.warn('closing connection: rate limit exceeded');
        send({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages — connection closed.' });
        ws.close(4008, 'rate limit exceeded');
        return;
      }

      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send({ type: 'error', code: 'INVALID_JSON', message: 'Message was not valid JSON' });
        return;
      }

      if (parsed.type === 'hello') receivedHello = true;

      try {
        handleClientMessage(parsed, send);
      } catch (error) {
        handleError(error, send);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      unregister(send);
      log.info('client disconnected');
    });

    ws.on('error', (error) => {
      log.error({ err: error }, 'connection error');
    });
  });

  const sweepInterval = startHeartbeatSweep(wss);
  wss.on('close', () => clearInterval(sweepInterval));

  wss.on('listening', () => {
    log.info({ port: config.BACKEND_WS_PORT }, `listening on ws://127.0.0.1:${config.BACKEND_WS_PORT}`);
  });

  return wss;
}
