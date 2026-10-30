import { randomUUID } from 'node:crypto';
import { broadcast } from '../ws/connectionRegistry';
import { providersRepository } from '../db/repositories/providersRepository';
import { childLogger } from '../logger';

const log = childLogger('key-relay');
const REQUEST_TIMEOUT_MS = 8_000;

interface PendingRequest {
  resolve: (apiKey: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, PendingRequest>();

/**
 * The backend only ever stores an encrypted key blob (safeStorage can only
 * decrypt inside Electron's main process). This asks the renderer — which
 * has both the live WS connection and window.kvlAPI.decryptSecret — to
 * decrypt it and hand back a transient, memory-only plaintext copy. Never
 * persisted; only used for the duration of one provider.start() call.
 */
export function requestDecryptedKey(providerId: string): Promise<string> {
  const encrypted = providersRepository.getEncryptedKey(providerId);
  if (!encrypted) {
    return Promise.reject(new Error(`Provider ${providerId} has no stored API key`));
  }

  const requestId = randomUUID();

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Timed out waiting for the renderer to decrypt the provider key'));
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timeout });

    broadcast({
      type: 'providers:key-request',
      requestId,
      providerId,
      encryptedApiKeyBase64: encrypted.toString('base64'),
    });
  });
}

/** Called from protocolHandlers on a providers:key-response message. */
export function resolveKeyResponse(requestId: string, apiKey: string | null): void {
  const request = pending.get(requestId);
  if (!request) {
    log.warn({ requestId }, 'received key response for unknown/expired request');
    return;
  }
  pending.delete(requestId);
  clearTimeout(request.timeout);
  if (apiKey) request.resolve(apiKey);
  else request.reject(new Error('Renderer could not decrypt the provider key'));
}
