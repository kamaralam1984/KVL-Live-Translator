import type { AudioLevels } from '@kvl/audio';

const SILENCE_THRESHOLD = 0.01;
const SMOOTHING = 0.6; // exponential moving average factor, keeps UI meters from jittering

/** Computes RMS/peak/normalized levels for one frame of samples. Pure function — no state. */
export function computeLevels(samples: Float32Array): AudioLevels {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  return {
    rms,
    peak,
    normalized: Math.min(1, rms * 4), // empirical gain so typical speech reads near mid-scale
    silent: rms < SILENCE_THRESHOLD,
  };
}

/** Stateful wrapper that smooths levels over time for jitter-free UI meters. */
export class AudioLevelAnalyzer {
  private smoothed: AudioLevels = { rms: 0, peak: 0, normalized: 0, silent: true };

  update(samples: Float32Array): AudioLevels {
    const instant = computeLevels(samples);
    this.smoothed = {
      rms: this.smoothed.rms * SMOOTHING + instant.rms * (1 - SMOOTHING),
      peak: Math.max(instant.peak, this.smoothed.peak * SMOOTHING),
      normalized: this.smoothed.normalized * SMOOTHING + instant.normalized * (1 - SMOOTHING),
      silent: instant.silent,
    };
    return this.smoothed;
  }

  get current(): AudioLevels {
    return this.smoothed;
  }

  reset(): void {
    this.smoothed = { rms: 0, peak: 0, normalized: 0, silent: true };
  }
}
