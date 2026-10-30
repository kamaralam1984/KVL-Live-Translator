import type { AudioLevels, CaptureMode } from '@kvl/audio';
import type { AudioEngineState, AudioFrame, AudioSourceTag } from './types';
import { AudioCaptureError } from './errors';
import { AudioPermissionManager } from './AudioPermissionManager';
import { AudioDeviceManager, type MicDeviceInfo } from './AudioDeviceManager';
import { MicrophoneCapture } from './MicrophoneCapture';
import { SystemAudioCapture } from './SystemAudioCapture';
import { AudioMixer } from './AudioMixer';
import { AudioChunkProcessor } from './AudioChunkProcessor';
import { AudioSessionManager } from './AudioSessionManager';
import { CAPTURE_FORMAT } from './AudioFormat';
import { createMockMediaStream } from './MockAudioSource';
import { audioEventBus } from './eventBus';
import { MicRetryPolicy } from './MicRetryPolicy';

const WORKLET_NAME = 'kvl-frame-processor';
// Served as a static plain-JS asset from src/renderer/public/worklets/ — see
// that file for why it can't be a bundled TS module (Vite has no
// AudioWorklet-aware asset pipeline; addModule() needs a real, already-valid
// JS file at a fetchable URL, not a bundler-transformed import).
const WORKLET_URL = './worklets/frame-processor.worklet.js';

export interface StartCaptureOptions {
  sessionId: string;
  mode: CaptureMode;
  micDeviceId?: string;
  micDeviceLabel?: string;
  /** When true, uses MockAudioSource instead of real device/display capture. */
  testMode?: boolean;
}

type StateListener = (state: AudioEngineState) => void;

/**
 * Central controller/state machine — the only class the UI talks to. Wires
 * MicrophoneCapture/SystemAudioCapture/AudioMixer streams through an
 * AudioWorkletNode into a per-source AudioChunkProcessor, which emits
 * finished `chunk:ready` events on the shared eventBus.
 */
export class AudioCaptureManager {
  private state: AudioEngineState = 'idle';
  private readonly stateListeners = new Set<StateListener>();

  private audioContext: AudioContext | null = null;
  private readonly deviceManager = new AudioDeviceManager();
  private readonly micCapture = new MicrophoneCapture();
  private readonly systemCapture = new SystemAudioCapture();
  private mixer: AudioMixer | null = null;
  readonly session = new AudioSessionManager();

  private readonly workletNodes = new Map<AudioSourceTag, AudioWorkletNode>();
  private readonly sourceNodes = new Map<AudioSourceTag, MediaStreamAudioSourceNode>();
  private readonly chunkProcessors = new Map<AudioSourceTag, AudioChunkProcessor>();
  private readonly lastLevels = new Map<AudioSourceTag, AudioLevels>();
  private lastError: AudioCaptureError | null = null;
  private paused = false;
  private micDeviceId: string | undefined;
  private readonly micRetryPolicy = new MicRetryPolicy();
  private micRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    audioEventBus.on('levels:update', ({ source, levels }) => this.lastLevels.set(source, levels));
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: AudioEngineState): void {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  async initialize(): Promise<void> {
    if (this.audioContext) return;
    this.setState('initializing');
    try {
      this.audioContext = new AudioContext({ sampleRate: CAPTURE_FORMAT.sampleRate });
      await this.audioContext.audioWorklet.addModule(WORKLET_URL);
      this.mixer = new AudioMixer(this.audioContext);
      this.setState('ready');
    } catch (error) {
      this.lastError = error instanceof AudioCaptureError ? error : new AudioCaptureError('AUDIO_INITIALIZATION_FAILED', String(error));
      this.setState('error');
      throw this.lastError;
    }
  }

  getDevices(): Promise<MicDeviceInfo[]> {
    return this.deviceManager.listMicrophones();
  }

  onDevicesChanged(listener: (devices: MicDeviceInfo[]) => void): () => void {
    return this.deviceManager.onChange(listener);
  }

  requestPermissions() {
    return AudioPermissionManager.requestMicrophonePermission();
  }

  async start(options: StartCaptureOptions): Promise<void> {
    if (!this.audioContext || !this.mixer) await this.initialize();
    this.setState('requesting-permission');
    this.micDeviceId = options.micDeviceId;
    this.micRetryPolicy.reset();
    if (this.micRetryTimeoutId) {
      clearTimeout(this.micRetryTimeoutId);
      this.micRetryTimeoutId = null;
    }

    try {
      const streams: Partial<Record<AudioSourceTag, MediaStream>> = {};

      if (options.testMode) {
        if (options.mode === 'microphone' || options.mode === 'both') streams.microphone = createMockMediaStream();
        if (options.mode === 'system' || options.mode === 'both') streams.system = createMockMediaStream();
      } else {
        if (options.mode === 'microphone' || options.mode === 'both') {
          streams.microphone = await this.micCapture.start({
            deviceId: options.micDeviceId,
            onDisconnected: () => this.handleMicDisconnected(options.micDeviceLabel),
          });
        }
        if (options.mode === 'system' || options.mode === 'both') {
          streams.system = await this.systemCapture.start();
        }
      }

      this.session.start(options.sessionId, options.mode, options.micDeviceLabel);

      for (const [tag, stream] of Object.entries(streams) as [AudioSourceTag, MediaStream][]) {
        this.wireSource(tag, stream, options.sessionId);
      }

      if (options.mode === 'both' && streams.microphone && streams.system && this.mixer) {
        const mixedStream = this.mixer.mix([streams.microphone, streams.system]);
        this.wireSource('mixed', mixedStream, options.sessionId);
      }

      this.paused = false;
      this.setState('capturing');
    } catch (error) {
      this.lastError = error instanceof AudioCaptureError ? error : new AudioCaptureError('AUDIO_INITIALIZATION_FAILED', String(error));
      this.setState('error');
      audioEventBus.emit('error', { error: this.lastError });
      throw this.lastError;
    }
  }

  private wireSource(tag: AudioSourceTag, stream: MediaStream, sessionId: string): void {
    if (!this.audioContext) return;

    const sourceNode = this.audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(this.audioContext, WORKLET_NAME);
    const processor = new AudioChunkProcessor({ sessionId, source: tag, onOverflow: (dropped) => audioEventBus.emit('buffer:overflow', { source: tag, droppedFrames: dropped }) });

    workletNode.port.onmessage = (event: MessageEvent<AudioFrame>) => {
      if (this.paused) return;
      processor.pushFrame(event.data);
    };

    sourceNode.connect(workletNode);
    this.sourceNodes.set(tag, sourceNode);
    this.workletNodes.set(tag, workletNode);
    this.chunkProcessors.set(tag, processor);
  }

  /** Replaces an existing source's WebAudio nodes with fresh ones wired to a
   * newly (re)acquired stream — wireSource() alone would leak the old,
   * now-dead sourceNode/workletNode pair. */
  private rewireSource(tag: AudioSourceTag, stream: MediaStream, sessionId: string): void {
    const oldWorklet = this.workletNodes.get(tag);
    if (oldWorklet) {
      oldWorklet.port.onmessage = null;
      oldWorklet.disconnect();
    }
    this.sourceNodes.get(tag)?.disconnect();
    this.wireSource(tag, stream, sessionId);
  }

  private handleMicDisconnected(label?: string): void {
    audioEventBus.emit('device:disconnected', { deviceId: '', label: label ?? 'Microphone' });

    // Deliberately does not auto-switch devices — spec §6: never silently
    // switch. This only retries the SAME device, bounded, before falling
    // back to the terminal error state that prompts the user to pick
    // another device and call start() again.
    if (this.micRetryPolicy.exhausted) {
      this.lastError = new AudioCaptureError('AUDIO_DEVICE_DISCONNECTED', 'Microphone disconnected');
      audioEventBus.emit('error', { error: this.lastError });
      return;
    }

    const attempt = this.micRetryPolicy.attemptNumber + 1;
    const delayMs = this.micRetryPolicy.nextDelayMs();
    audioEventBus.emit('device:reconnecting', { label: label ?? 'Microphone', attempt, delayMs });
    this.micRetryTimeoutId = setTimeout(() => void this.attemptMicReconnect(label), delayMs);
  }

  private async attemptMicReconnect(label?: string): Promise<void> {
    this.micRetryTimeoutId = null;
    const sessionId = this.session.session?.sessionId;
    if (!sessionId) return; // session already ended/stopped while waiting — abandon the retry

    try {
      const stream = await this.micCapture.start({
        deviceId: this.micDeviceId,
        onDisconnected: () => this.handleMicDisconnected(label),
      });
      this.rewireSource('microphone', stream, sessionId);
      this.micRetryPolicy.reset();
      audioEventBus.emit('device:reconnected', { deviceId: '', label: label ?? 'Microphone' });
    } catch {
      // Device still unavailable — count this as another attempt via the
      // same bounded path rather than looping unboundedly here.
      this.handleMicDisconnected(label);
    }
  }

  pause(): void {
    if (this.state !== 'capturing') return;
    this.paused = true;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.paused = false;
    this.setState('capturing');
  }

  async stop(): Promise<void> {
    this.setState('stopping');

    if (this.micRetryTimeoutId) {
      clearTimeout(this.micRetryTimeoutId);
      this.micRetryTimeoutId = null;
    }

    for (const node of this.workletNodes.values()) {
      node.port.onmessage = null;
      node.disconnect();
    }
    for (const node of this.sourceNodes.values()) node.disconnect();
    this.workletNodes.clear();
    this.sourceNodes.clear();
    this.chunkProcessors.clear();
    this.lastLevels.clear();

    this.mixer?.teardown();
    this.micCapture.stop();
    this.systemCapture.stop();
    this.session.end();
    this.paused = false;

    this.setState('stopped');
  }

  destroy(): void {
    void this.stop();
    this.audioContext?.close();
    this.audioContext = null;
    this.mixer = null;
    this.stateListeners.clear();
  }

  getStatus(): AudioEngineState {
    return this.state;
  }

  getAudioLevels(): Partial<Record<AudioSourceTag, AudioLevels>> {
    return Object.fromEntries(this.lastLevels);
  }

  getDiagnosticsForSource(tag: AudioSourceTag) {
    return this.chunkProcessors.get(tag)?.diagnostics;
  }

  get error(): AudioCaptureError | null {
    return this.lastError;
  }
}
