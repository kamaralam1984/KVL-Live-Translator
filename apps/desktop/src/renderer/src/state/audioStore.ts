import { create } from 'zustand';
import type { AudioLevels, CaptureMode } from '@kvl/audio';
import type { AudioEngineState, AudioSourceTag, VadState } from '../audio/types';
import type { MicDeviceInfo } from '../audio/AudioDeviceManager';

/** Phase 14: 'reconnecting' covers a bounded same-device auto-retry after a
 * mid-meeting disconnect, before falling back to 'error'. */
export type SourceStatus = 'idle' | 'connecting' | 'listening' | 'paused' | 'error' | 'unavailable' | 'reconnecting';

const EMPTY_LEVELS: AudioLevels = { rms: 0, peak: 0, normalized: 0, silent: true };

interface AudioStoreState {
  engineState: AudioEngineState;
  captureMode: CaptureMode;
  testMode: boolean;
  micStatus: SourceStatus;
  systemStatus: SourceStatus;
  micLevels: AudioLevels;
  systemLevels: AudioLevels;
  vadState: VadState | 'unknown';
  devices: MicDeviceInfo[];
  selectedMicDeviceId?: string;
  selectedMicLabel?: string;
  lastError?: string;
  droppedFrames: number;
  chunksEmitted: number;

  setEngineState: (state: AudioEngineState) => void;
  setCaptureMode: (mode: CaptureMode) => void;
  setTestMode: (on: boolean) => void;
  setSourceStatus: (source: AudioSourceTag, status: SourceStatus) => void;
  setLevels: (source: AudioSourceTag, levels: AudioLevels) => void;
  setVadState: (state: VadState) => void;
  setDevices: (devices: MicDeviceInfo[]) => void;
  selectMic: (deviceId: string | undefined, label: string | undefined) => void;
  setError: (message: string | undefined) => void;
  /** `dropped` is the cumulative total from AudioBuffer, not a delta. */
  setDroppedFrames: (dropped: number) => void;
  recordChunkEmitted: () => void;
  reset: () => void;
}

export const useAudioStore = create<AudioStoreState>((set) => ({
  engineState: 'idle',
  captureMode: 'both',
  testMode: false,
  micStatus: 'idle',
  systemStatus: 'idle',
  micLevels: EMPTY_LEVELS,
  systemLevels: EMPTY_LEVELS,
  vadState: 'unknown',
  devices: [],
  droppedFrames: 0,
  chunksEmitted: 0,

  setEngineState: (engineState) => set({ engineState }),
  setCaptureMode: (captureMode) => set({ captureMode }),
  setTestMode: (testMode) => set({ testMode }),
  setSourceStatus: (source, status) =>
    set(source === 'microphone' ? { micStatus: status } : source === 'system' ? { systemStatus: status } : {}),
  setLevels: (source, levels) =>
    set(source === 'microphone' ? { micLevels: levels } : source === 'system' ? { systemLevels: levels } : {}),
  setVadState: (vadState) => set({ vadState }),
  setDevices: (devices) => set({ devices }),
  selectMic: (selectedMicDeviceId, selectedMicLabel) => set({ selectedMicDeviceId, selectedMicLabel }),
  setError: (lastError) => set({ lastError }),
  setDroppedFrames: (droppedFrames) => set({ droppedFrames }),
  recordChunkEmitted: () => set((state) => ({ chunksEmitted: state.chunksEmitted + 1 })),
  reset: () =>
    set({
      engineState: 'idle',
      micStatus: 'idle',
      systemStatus: 'idle',
      micLevels: EMPTY_LEVELS,
      systemLevels: EMPTY_LEVELS,
      vadState: 'unknown',
      lastError: undefined,
    }),
}));
