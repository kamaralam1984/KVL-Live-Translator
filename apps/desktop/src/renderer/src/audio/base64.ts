const CHUNK_SIZE = 0x8000; // avoid String.fromCharCode argument-count limits on large arrays

/** btoa()-based encoding (no Node Buffer available in the renderer — contextIsolation is on, nodeIntegration is off). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}
