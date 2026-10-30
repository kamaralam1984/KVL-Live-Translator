import type { FileFilter } from './fileExport';

/**
 * Phase 13 — runtime validation at the IPC boundary. TypeScript types are
 * compile-time only and give zero protection if the renderer bundle were
 * ever compromised (e.g. a supply-chain-compromised dependency); every
 * `ipcMain.handle` that accepts non-trivial renderer input validates its
 * arguments here first. Plain guard functions rather than pulling in zod
 * (a dependency this app doesn't otherwise have) — the checks needed are
 * simple enough not to warrant a new dependency in the desktop app.
 * A thrown IpcValidationError propagates back to the renderer's
 * `ipcRenderer.invoke()` call as a rejected promise — normal Electron
 * behavior, no crash risk.
 */
export class IpcValidationError extends Error {}

const MAX_TEXT_LENGTH = 10 * 1024 * 1024; // 10MB — generous for a full meeting transcript/summary export
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9 ._-]+$/;

export function assertString(value: unknown, name: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new IpcValidationError(`${name} must be a string`);
  if (value.length > maxLength) throw new IpcValidationError(`${name} exceeds the maximum allowed length (${maxLength})`);
  return value;
}

/** Path traversal is already structurally prevented — this only ever
 * pre-fills Electron's native save dialog (dialog.showSaveDialog), never
 * the actual write path — but a charset check is cheap defense in depth. */
export function assertSafeFilename(value: unknown, name: string): string {
  const str = assertString(value, name, 255);
  if (!SAFE_FILENAME_REGEX.test(str)) throw new IpcValidationError(`${name} contains characters that aren't allowed in a filename`);
  return str;
}

export function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new IpcValidationError(`${name} must be a boolean`);
  return value;
}

export function assertNumberInRange(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new IpcValidationError(`${name} must be a number`);
  if (value < min || value > max) throw new IpcValidationError(`${name} must be between ${min} and ${max}`);
  return value;
}

export function assertEnum<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new IpcValidationError(`${name} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

export function assertFileFilters(value: unknown, name: string): FileFilter[] {
  if (!Array.isArray(value)) throw new IpcValidationError(`${name} must be an array`);
  return value.map((filter, i) => {
    if (typeof filter !== 'object' || filter === null) throw new IpcValidationError(`${name}[${i}] must be an object`);
    const record = filter as Record<string, unknown>;
    const filterName = assertString(record.name, `${name}[${i}].name`, 100);
    const extensions = record.extensions;
    if (!Array.isArray(extensions) || !extensions.every((e) => typeof e === 'string')) {
      throw new IpcValidationError(`${name}[${i}].extensions must be an array of strings`);
    }
    return { name: filterName, extensions: extensions as string[] };
  });
}
