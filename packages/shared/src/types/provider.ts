export type ProviderKind = 'stt' | 'translation' | 'response' | 'tts' | 'explanation' | 'copilot' | 'summary';

/** Shape sent to the renderer — never carries a decrypted secret. */
export interface ProviderConfigPublic {
  id: string;
  kind: ProviderKind;
  name: string;
  providerKey: string;
  baseUrl?: string;
  model?: string;
  hasApiKey: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shape sent from the renderer when saving a provider — apiKey is already
 * safeStorage-encrypted (base64) by the Electron main process before this
 * ever reaches the backend over the WebSocket. */
export interface ProviderConfigInput {
  id?: string;
  kind: ProviderKind;
  name: string;
  providerKey: string;
  baseUrl?: string;
  model?: string;
  encryptedApiKey?: string;
  isActive?: boolean;
}
