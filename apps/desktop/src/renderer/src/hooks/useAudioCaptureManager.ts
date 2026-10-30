import { useCallback } from 'react';
import type { CaptureMode } from '@kvl/audio';
import { AudioCaptureManager } from '../audio/AudioCaptureManager';
import { audioEventBus } from '../audio/eventBus';
import { floatTo16BitPCM } from '../audio/AudioFormat';
import { bytesToBase64 } from '../audio/base64';
import { useAudioStore } from '../state/audioStore';
import { send } from '../services/wsClient';
import { MIC_RETRY_DELAYS_MS } from '../audio/MicRetryPolicy';

/** True app-wide singleton — audio capture must not be re-instantiated per component. */
const manager = new AudioCaptureManager();

let wired = false;
function wireEventsOnce(): void {
  if (wired) return;
  wired = true;

  manager.onStateChange((state) => useAudioStore.getState().setEngineState(state));

  audioEventBus.on('levels:update', ({ source, levels }) => useAudioStore.getState().setLevels(source, levels));
  audioEventBus.on('vad:state', ({ state }) => useAudioStore.getState().setVadState(state));
  audioEventBus.on('buffer:overflow', ({ droppedFrames }) => useAudioStore.getState().setDroppedFrames(droppedFrames));
  audioEventBus.on('chunk:ready', (payload) => {
    useAudioStore.getState().recordChunkEmitted();

    // Phase 3: forward each VAD-bounded speech chunk to the backend's STT
    // pipeline over the existing WS connection (reused JSON protocol —
    // see packages/shared/src/ws-protocol.ts's `audio:chunk`).
    const pcm16 = floatTo16BitPCM(payload.audioData);
    const audioBase64 = bytesToBase64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));
    send({
      type: 'audio:chunk',
      sessionId: payload.sessionId,
      chunkId: payload.chunkId,
      source: payload.source,
      sequenceNumber: payload.sequenceNumber,
      timestampMs: payload.timestamp,
      durationMs: payload.duration,
      format: payload.format,
      audioBase64,
    });
  });
  audioEventBus.on('error', ({ error }) => {
    useAudioStore.getState().setError(error.message);
    // The bounded mic-retry loop already showed 'reconnecting' — this only
    // fires once that retry is exhausted (see AudioCaptureManager.handleMicDisconnected),
    // so it's the correct point to fall back to the terminal manual-prompt state.
    if (error.code === 'AUDIO_DEVICE_DISCONNECTED') {
      useAudioStore.getState().setSourceStatus('microphone', 'error');
    }
  });
  // Informational only — device:reconnecting (fired immediately after, from
  // the same disconnect handling) owns the status transition into
  // 'reconnecting', and a bounded same-device retry runs before any
  // terminal 'error' event ever fires.
  audioEventBus.on('device:disconnected', () => {});
  audioEventBus.on('device:reconnecting', ({ attempt }) => {
    useAudioStore.getState().setSourceStatus('microphone', 'reconnecting');
    useAudioStore.getState().setError(`Audio capture interrupted. Reconnecting... (attempt ${attempt}/${MIC_RETRY_DELAYS_MS.length})`);
  });
  audioEventBus.on('device:reconnected', () => {
    useAudioStore.getState().setSourceStatus('microphone', 'listening');
    useAudioStore.getState().setError(undefined);
  });
}
wireEventsOnce();

export interface StartAudioOptions {
  sessionId: string;
  mode: CaptureMode;
  micDeviceId?: string;
  micDeviceLabel?: string;
  testMode?: boolean;
}

function markSourceStatus(mode: CaptureMode, status: 'connecting' | 'listening' | 'error'): void {
  if (mode === 'microphone' || mode === 'both') useAudioStore.getState().setSourceStatus('microphone', status);
  if (mode === 'system' || mode === 'both') useAudioStore.getState().setSourceStatus('system', status);
}

export function useAudioCaptureManager() {
  const store = useAudioStore();

  const start = useCallback(async (options: StartAudioOptions) => {
    useAudioStore.getState().setCaptureMode(options.mode);
    useAudioStore.getState().setTestMode(Boolean(options.testMode));
    useAudioStore.getState().setError(undefined);
    markSourceStatus(options.mode, 'connecting');
    try {
      await manager.start(options);
      markSourceStatus(options.mode, 'listening');
    } catch (error) {
      markSourceStatus(options.mode, 'error');
      throw error;
    }
  }, []);

  const pause = useCallback(() => {
    manager.pause();
    const mode = useAudioStore.getState().captureMode;
    if (mode === 'microphone' || mode === 'both') useAudioStore.getState().setSourceStatus('microphone', 'paused');
    if (mode === 'system' || mode === 'both') useAudioStore.getState().setSourceStatus('system', 'paused');
  }, []);

  const resume = useCallback(() => {
    manager.resume();
    markSourceStatus(useAudioStore.getState().captureMode, 'listening');
  }, []);

  const stop = useCallback(async () => {
    await manager.stop();
    useAudioStore.getState().reset();
  }, []);

  const getDevices = useCallback(() => manager.getDevices(), []);
  const requestPermissions = useCallback(() => manager.requestPermissions(), []);

  return { ...store, manager, start, pause, resume, stop, getDevices, requestPermissions };
}
