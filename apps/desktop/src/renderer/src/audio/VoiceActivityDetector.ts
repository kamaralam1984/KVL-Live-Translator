import type { AudioFrame, VadState } from './types';
import { FRAME_DURATION_MS } from './AudioFormat';

export interface VadOptions {
  /** RMS threshold above which a frame counts as "loud enough to be speech". 0-1 range. */
  sensitivity?: number;
  /** Consecutive loud time required before declaring SPEECH_START. */
  minSpeechDurationMs?: number;
  /** Consecutive quiet time required before declaring SPEECH_END. */
  minSilenceDurationMs?: number;
}

const DEFAULTS: Required<VadOptions> = {
  sensitivity: 0.02,
  minSpeechDurationMs: 200,
  minSilenceDurationMs: 500,
};

/**
 * Energy-based (RMS + hysteresis) voice activity detector. No ML dependency
 * by design — Phase 2 explicitly excludes AI/STT, and a simple threshold
 * detector is sufficient to avoid feeding pure silence into Phase 3.
 *
 * DOM-free: consumes plain AudioFrame objects (timestamp + rms), so it can
 * be driven by a live AudioWorklet, a mock generator, or a test script
 * identically.
 */
export class VoiceActivityDetector {
  private readonly options: Required<VadOptions>;
  private state: VadState = 'silence';
  private runningMs = 0;

  constructor(options: VadOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  get currentState(): VadState {
    return this.state;
  }

  /** Feeds one frame; returns the (possibly unchanged) state after processing it. */
  processFrame(frame: AudioFrame): VadState {
    const isLoud = frame.rms >= this.options.sensitivity;

    switch (this.state) {
      case 'silence':
      case 'speech-end':
        if (isLoud) {
          this.runningMs += FRAME_DURATION_MS;
          if (this.runningMs >= this.options.minSpeechDurationMs) {
            this.state = 'speech-start';
            this.runningMs = 0;
          } else {
            this.state = 'silence';
          }
        } else {
          this.runningMs = 0;
          this.state = 'silence';
        }
        break;

      case 'speech-start':
        // One-shot transitional state — the frame after start settles into steady SPEECH.
        this.state = isLoud ? 'speech' : 'speech-end';
        if (!isLoud) this.runningMs = FRAME_DURATION_MS;
        break;

      case 'speech':
        if (isLoud) {
          this.runningMs = 0;
        } else {
          this.runningMs += FRAME_DURATION_MS;
          if (this.runningMs >= this.options.minSilenceDurationMs) {
            this.state = 'speech-end';
            this.runningMs = 0;
          }
        }
        break;
    }

    return this.state;
  }

  get isSpeaking(): boolean {
    return this.state === 'speech-start' || this.state === 'speech';
  }

  reset(): void {
    this.state = 'silence';
    this.runningMs = 0;
  }
}
