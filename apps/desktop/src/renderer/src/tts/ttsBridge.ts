import type { VoiceInfo } from '@kvl/shared';
import { send } from '../services/wsClient';
import { useTtsStore } from '../state/ttsStore';

const REQUEST_TIMEOUT_MS = 20_000;

interface PendingSynthesize {
  resolve: (result: { audioBase64: string; mimeType: string; providerId: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  /** Phase 14 renderer-observed latency — stamped when the request is sent. */
  startedAt: number;
}

interface PendingVoices {
  resolve: (voices: VoiceInfo[]) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingSynthesize = new Map<string, PendingSynthesize>();
const pendingVoices = new Map<string, PendingVoices>();

function randomRequestId(): string {
  return `tts-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Correlates a tts:synthesize request with its tts:audio/tts:error reply —
 * same requestId-keyed pending-Map pattern as the backend's
 * apps/backend/src/speech/keyRelay.ts. Used by BackendTtsProvider (both the
 * 'local' and 'cloud' tiers share this bridge, keyed globally by requestId).
 */
export function requestSynthesize(tier: 'local' | 'cloud', text: string, voiceId?: string, speed?: number): Promise<{ audioBase64: string; mimeType: string; providerId: string }> {
  const requestId = randomRequestId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSynthesize.delete(requestId);
      reject(new Error(`Timed out waiting for ${tier} TTS synthesis`));
    }, REQUEST_TIMEOUT_MS);

    pendingSynthesize.set(requestId, { resolve, reject, timeout, startedAt: Date.now() });
    send({ type: 'tts:synthesize', requestId, tier, text, voiceId, speed });
  });
}

export function requestVoices(tier: 'local' | 'cloud'): Promise<VoiceInfo[]> {
  const requestId = randomRequestId();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingVoices.delete(requestId);
      resolve([]); // honest empty list rather than hanging the caller
    }, REQUEST_TIMEOUT_MS);

    pendingVoices.set(requestId, { resolve, timeout });
    send({ type: 'tts:list-voices', requestId, tier });
  });
}

/** Called from wsClient.ts on a tts:audio message. */
export function resolveTtsAudio(requestId: string, audioBase64: string, mimeType: string, providerId: string): void {
  const pending = pendingSynthesize.get(requestId);
  if (!pending) return; // unknown/expired — ignore
  pendingSynthesize.delete(requestId);
  clearTimeout(pending.timeout);
  useTtsStore.getState().setLatency(Date.now() - pending.startedAt);
  pending.resolve({ audioBase64, mimeType, providerId });
}

/** Called from wsClient.ts on a tts:error message. */
export function rejectTtsSynthesize(requestId: string, message: string): void {
  const pending = pendingSynthesize.get(requestId);
  if (!pending) return;
  pendingSynthesize.delete(requestId);
  clearTimeout(pending.timeout);
  pending.reject(new Error(message));
}

/** Called from wsClient.ts on a tts:voices message. */
export function resolveTtsVoices(requestId: string, voices: VoiceInfo[]): void {
  const pending = pendingVoices.get(requestId);
  if (!pending) return;
  pendingVoices.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(voices);
}
