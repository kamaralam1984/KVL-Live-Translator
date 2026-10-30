import type { AudioFormat } from '@kvl/audio';
import type { AudioChunkReadyPayload, AudioFrame, AudioSourceTag, VadState } from './types';
import { AudioBuffer } from './AudioBuffer';
import { VoiceActivityDetector, type VadOptions } from './VoiceActivityDetector';
import { AudioLevelAnalyzer } from './AudioLevelAnalyzer';
import { CAPTURE_FORMAT, EXPORT_FORMAT, FRAME_DURATION_MS, downsample } from './AudioFormat';
import { audioEventBus } from './eventBus';

const RING_BUFFER_MS = 10_000; // diagnostics/backpressure window, not the chunk itself
const MAX_CHUNK_DURATION_MS = 30_000; // safety cap so unbroken speech still yields bounded chunks

export interface AudioChunkProcessorOptions {
  sessionId: string;
  source: AudioSourceTag;
  vad?: VadOptions;
  format?: AudioFormat;
  onOverflow?: (droppedFrames: number) => void;
}

/**
 * DOM-free pipeline core: Frame -> ring buffer (diagnostics) -> VAD ->
 * speech-segment accumulation -> finalized AudioChunk emitted via the event
 * bus. Only frames that fall inside a detected speech segment become part
 * of a chunk — matches the spec's "do not send unnecessary silence to STT".
 */
export class AudioChunkProcessor {
  private readonly sessionId: string;
  private readonly source: AudioSourceTag;
  private readonly format: AudioFormat;
  private readonly ringBuffer: AudioBuffer;
  private readonly vad: VoiceActivityDetector;
  private readonly levelAnalyzer = new AudioLevelAnalyzer();

  private speechFrames: AudioFrame[] = [];
  private speechStartedAt = 0;
  private sequenceNumber = 0;

  constructor(options: AudioChunkProcessorOptions) {
    this.sessionId = options.sessionId;
    this.source = options.source;
    this.format = options.format ?? EXPORT_FORMAT;
    this.ringBuffer = new AudioBuffer({ maxDurationMs: RING_BUFFER_MS, onOverflow: options.onOverflow });
    this.vad = new VoiceActivityDetector(options.vad);
  }

  /** Feeds one live/mock frame through the full pipeline. */
  pushFrame(frame: AudioFrame): VadState {
    this.ringBuffer.push(frame);

    const levels = this.levelAnalyzer.update(frame.samples);
    audioEventBus.emit('levels:update', { source: this.source, levels });

    const state = this.vad.processFrame(frame);
    audioEventBus.emit('vad:state', { source: this.source, state });

    if (state === 'speech-start') {
      this.speechFrames = [frame];
      this.speechStartedAt = frame.timestamp;
    } else if (state === 'speech') {
      this.speechFrames.push(frame);
      if (this.speechFrames.length * FRAME_DURATION_MS >= MAX_CHUNK_DURATION_MS) {
        this.finalizeChunk(frame.timestamp);
      }
    } else if (state === 'speech-end') {
      this.speechFrames.push(frame);
      this.finalizeChunk(frame.timestamp);
    }

    return state;
  }

  private finalizeChunk(endTimestamp: number): void {
    if (this.speechFrames.length === 0) return;

    const totalSamples = this.speechFrames.reduce((sum, f) => sum + f.samples.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const f of this.speechFrames) {
      merged.set(f.samples, offset);
      offset += f.samples.length;
    }

    const exported = downsample(merged, CAPTURE_FORMAT.sampleRate, this.format.sampleRate);
    this.sequenceNumber += 1;

    const payload: AudioChunkReadyPayload = {
      sessionId: this.sessionId,
      chunkId: `${this.sessionId}-${this.source}-${this.sequenceNumber}`,
      source: this.source,
      timestamp: this.speechStartedAt,
      duration: endTimestamp - this.speechStartedAt + FRAME_DURATION_MS,
      format: this.format,
      speechDetected: true,
      sequenceNumber: this.sequenceNumber,
      audioData: exported,
    };

    audioEventBus.emit('chunk:ready', payload);
    this.speechFrames = [];
  }

  get diagnostics() {
    return {
      ringBufferedMs: this.ringBuffer.bufferedDurationMs,
      ringBufferFrames: this.ringBuffer.frameCount,
      droppedFrames: this.ringBuffer.droppedFrameCount,
      vadState: this.vad.currentState,
      accumulatedSpeechFrames: this.speechFrames.length,
      chunksEmitted: this.sequenceNumber,
    };
  }

  reset(): void {
    this.ringBuffer.clear();
    this.vad.reset();
    this.levelAnalyzer.reset();
    this.speechFrames = [];
    this.sequenceNumber = 0;
  }
}
