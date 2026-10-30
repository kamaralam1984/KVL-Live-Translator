import type { AudioFrame } from './types';
import { FRAME_DURATION_MS } from './AudioFormat';

export interface AudioBufferOptions {
  /** Hard cap on buffered audio, in milliseconds — never grows past this. */
  maxDurationMs: number;
  frameDurationMs?: number;
  onOverflow?: (droppedFrames: number) => void;
}

/**
 * Bounded FIFO of audio frames. DOM-free — pure data structure, unit-testable
 * with plain arrays of numbers standing in for real audio samples.
 *
 * Backpressure policy: when full, the oldest frame is dropped to make room
 * for the newest one (never silently grows unbounded), and `onOverflow`
 * fires so the caller can log diagnostics.
 */
export class AudioBuffer {
  private readonly maxFrames: number;
  private frames: AudioFrame[] = [];
  private readonly onOverflow?: (droppedFrames: number) => void;
  private totalDropped = 0;

  constructor(options: AudioBufferOptions) {
    const frameDurationMs = options.frameDurationMs ?? FRAME_DURATION_MS;
    this.maxFrames = Math.max(1, Math.ceil(options.maxDurationMs / frameDurationMs));
    this.onOverflow = options.onOverflow;
  }

  push(frame: AudioFrame): void {
    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
      this.totalDropped += 1;
      this.onOverflow?.(this.totalDropped);
    }
    this.frames.push(frame);
  }

  /** Removes and returns all currently buffered frames. */
  drain(): AudioFrame[] {
    const drained = this.frames;
    this.frames = [];
    return drained;
  }

  peek(): readonly AudioFrame[] {
    return this.frames;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get bufferedDurationMs(): number {
    return this.frames.length * FRAME_DURATION_MS;
  }

  get droppedFrameCount(): number {
    return this.totalDropped;
  }

  clear(): void {
    this.frames = [];
  }
}
