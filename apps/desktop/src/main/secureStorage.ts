import { safeStorage } from 'electron';
import { logger } from './logger';

/**
 * Wraps Electron's safeStorage so provider API keys are encrypted at rest
 * before they ever leave the main process. The backend (over WebSocket)
 * only ever sees the base64 ciphertext this produces — it never has access
 * to safeStorage itself, since that API only exists in Electron's main
 * process.
 */
export function isEncryptionAvailable(): boolean {
  const available = safeStorage.isEncryptionAvailable();
  if (!available) {
    logger.warn('safeStorage encryption is not available on this system (no OS keyring found)');
  }
  return available;
}

export function encryptSecret(plainText: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  return safeStorage.encryptString(plainText).toString('base64');
}

export function decryptSecret(encryptedBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'));
}
