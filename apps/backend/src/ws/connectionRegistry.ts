import type { ServerMessage } from '@kvl/shared';
import type { Send } from './protocolHandlers';

/**
 * Tracks connected clients' `send` functions so backend-initiated messages
 * (SpeechManager's transcript:update/stt:status, the key-relay's
 * providers:key-request) can reach the renderer without waiting for it to
 * send a message first. This is a local single-user desktop app, but as of
 * Phase 12's floating mini window it's routine to have TWO simultaneously
 * connected renderers (main window + mini window, each a separate
 * BrowserWindow/process with its own WS connection) — every broadcast type
 * reaches both equally, with no per-connection ownership or session
 * affinity. That's fine today (nothing is keyed to connection identity or
 * count), but any future feature that assumes connections.size <= 1 (e.g.
 * "which window is focused," or gating TTS playback to avoid double-playing
 * audio from two windows at once) needs to account for this explicitly.
 */
const connections = new Set<Send>();

export function register(send: Send): void {
  connections.add(send);
}

export function unregister(send: Send): void {
  connections.delete(send);
}

export function broadcast(message: ServerMessage): void {
  for (const send of connections) send(message);
}

export function hasConnections(): boolean {
  return connections.size > 0;
}
