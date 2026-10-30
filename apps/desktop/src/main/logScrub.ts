const MAX_LOGGED_MESSAGE_LENGTH = 300;
// Matches both JSON-shaped ("apiKey":"...") and plain-text-shaped
// (token: "...", secret=...) key/value pairs, case-insensitive, with or
// without quotes around the key.
const SENSITIVE_KEY_PATTERN = /(["']?(?:[a-z_]*api[_-]?key[a-z_]*|token|secret|password)["']?\s*[:=]\s*)(["']?)([^"'\s,}]+)\2/gi;

/**
 * Phase 13 — unlike the backend's pino logger (which has a real `redact`
 * config since Phase 11), electron-log has none. The console-message
 * handler in index.ts pipes EVERY renderer console.* call into the log
 * file unfiltered — including two known error-path call sites in
 * wsClient.ts (malformed-WS-message handler, exhaustive-switch fallback)
 * that could contain a full ServerMessage payload (transcript/summary/
 * copilot content) if ever triggered. This bounds worst-case leakage
 * without disabling the handler's real diagnostic value for genuine
 * renderer errors.
 */
export function scrubForLog(message: string): string {
  const scrubbed = message.replace(SENSITIVE_KEY_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  return scrubbed.length > MAX_LOGGED_MESSAGE_LENGTH ? `${scrubbed.slice(0, MAX_LOGGED_MESSAGE_LENGTH)}… [truncated]` : scrubbed;
}
