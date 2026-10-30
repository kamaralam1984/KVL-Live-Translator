import type { AudioFrame } from './types';
import { CAPTURE_FORMAT, FRAME_DURATION_MS, FRAME_SAMPLE_COUNT } from './AudioFormat';
import { computeLevels } from './AudioLevelAnalyzer';

export interface MockSegment {
  kind: 'tone' | 'silence';
  durationMs: number;
}

/** Deterministic default pattern: 2s tone, 1s silence, repeating — enough to exercise VAD. */
export const DEFAULT_MOCK_PATTERN: MockSegment[] = [
  { kind: 'tone', durationMs: 2000 },
  { kind: 'silence', durationMs: 1000 },
];

const TONE_FREQUENCY_HZ = 220;
const TONE_AMPLITUDE = 0.3;

/**
 * Pure, DOM-free synthetic signal generator. Given an elapsed-time cursor
 * and a repeating pattern of tone/silence segments, deterministically
 * produces the same frames every run — this determinism is what makes it
 * possible to unit-test the whole capture pipeline (VAD, buffering,
 * chunking) without a real microphone or a browser.
 */
export class MockSignalGenerator {
  private readonly pattern: MockSegment[];
  private readonly patternDurationMs: number;
  private elapsedMs = 0;

  constructor(pattern: MockSegment[] = DEFAULT_MOCK_PATTERN) {
    this.pattern = pattern;
    this.patternDurationMs = pattern.reduce((sum, segment) => sum + segment.durationMs, 0);
  }

  /** Advances the generator by one frame duration and returns it. */
  nextFrame(): AudioFrame {
    const cursor = this.elapsedMs % this.patternDurationMs;
    const segment = this.segmentAt(cursor);
    const samples = new Float32Array(FRAME_SAMPLE_COUNT);

    if (segment.kind === 'tone') {
      const startTimeSec = this.elapsedMs / 1000;
      for (let i = 0; i < samples.length; i += 1) {
        const t = startTimeSec + i / CAPTURE_FORMAT.sampleRate;
        samples[i] = TONE_AMPLITUDE * Math.sin(2 * Math.PI * TONE_FREQUENCY_HZ * t);
      }
    }
    // silence segment: samples stay all-zero

    const frame: AudioFrame = {
      timestamp: this.elapsedMs,
      samples,
      rms: computeLevels(samples).rms,
    };

    this.elapsedMs += FRAME_DURATION_MS;
    return frame;
  }

  private segmentAt(cursorMs: number): MockSegment {
    let acc = 0;
    for (const segment of this.pattern) {
      acc += segment.durationMs;
      if (cursorMs < acc) return segment;
    }
    return this.pattern[this.pattern.length - 1];
  }

  reset(): void {
    this.elapsedMs = 0;
  }
}

/**
 * Browser-only adapter: turns the pure generator into a real MediaStream so
 * it can flow through the same AudioMixer/AudioCaptureManager graph as a
 * live microphone/system stream. Never called from the test script — only
 * referenced here, so this file still loads fine under plain Node for the
 * pure-generator unit test.
 */
export function createMockMediaStream(pattern: MockSegment[] = DEFAULT_MOCK_PATTERN): MediaStream {
  const audioContext = new AudioContext({ sampleRate: CAPTURE_FORMAT.sampleRate });
  const destination = audioContext.createMediaStreamDestination();
  const generator = new MockSignalGenerator(pattern);
  const bufferSize = FRAME_SAMPLE_COUNT;

  // ScriptProcessorNode is deprecated in favor of AudioWorklet, but is used here
  // deliberately: it avoids loading a second worklet module just for synthetic
  // test-mode audio, and its higher latency/main-thread cost is irrelevant for
  // a mock signal that never represents real capture latency.
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
  processor.onaudioprocess = (event) => {
    const frame = generator.nextFrame();
    event.outputBuffer.getChannelData(0).set(frame.samples);
  };
  processor.connect(destination);

  // ScriptProcessorNode requires an active graph to fire callbacks; route through a silent gain to the real destination too.
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return destination.stream;
}
