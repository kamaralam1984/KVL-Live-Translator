// Plain JavaScript, deliberately NOT TypeScript. AudioWorklet modules are
// loaded via `audioContext.audioWorklet.addModule(url)`, which fetches this
// file directly as a real, already-valid JS module — it never goes through
// Vite's bundler pipeline (Vite has no built-in AudioWorklet-aware asset
// handling the way it does for `new Worker()`; a `new URL(...)` reference to
// a .ts file gets embedded as an opaque, untranspiled asset with the wrong
// MIME type, which fails at runtime). Serving a plain-JS file from `public/`
// sidesteps all of that. FRAME_SAMPLE_COUNT is duplicated from
// src/renderer/src/audio/AudioFormat.ts (48000 * 20ms / 1000) since this file
// can't import from the TS source tree — keep the two in sync if either
// CAPTURE_FORMAT.sampleRate or FRAME_DURATION_MS ever changes.

const FRAME_SAMPLE_COUNT = 960;

class KvlFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.accumulator = new Float32Array(FRAME_SAMPLE_COUNT);
    this.writeIndex = 0;
    this.frameStartTime = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      if (this.writeIndex === 0) {
        this.frameStartTime = currentTime * 1000;
      }
      this.accumulator[this.writeIndex] = channel[i];
      this.writeIndex += 1;

      if (this.writeIndex === FRAME_SAMPLE_COUNT) {
        this.flush();
      }
    }

    return true;
  }

  flush() {
    let sumSquares = 0;
    for (let i = 0; i < this.accumulator.length; i += 1) {
      sumSquares += this.accumulator[i] * this.accumulator[i];
    }
    const rms = Math.sqrt(sumSquares / this.accumulator.length);

    const samplesCopy = this.accumulator.slice();
    this.port.postMessage({ timestamp: this.frameStartTime, samples: samplesCopy, rms }, [samplesCopy.buffer]);

    this.accumulator = new Float32Array(FRAME_SAMPLE_COUNT);
    this.writeIndex = 0;
  }
}

registerProcessor('kvl-frame-processor', KvlFrameProcessor);
