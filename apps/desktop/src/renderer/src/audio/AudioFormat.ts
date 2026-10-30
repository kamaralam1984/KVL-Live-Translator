import type { AudioFormat } from '@kvl/audio';

/** Internal canonical format — speech engines overwhelmingly expect 16kHz mono PCM16,
 * but we capture/process at 48kHz internally (native Web Audio rate) and only downsample
 * once, at the chunk-export boundary, to avoid resampling multiple times. */
export const CAPTURE_FORMAT: AudioFormat = {
  sampleRate: 48_000,
  channels: 1,
  bitDepth: 32, // Float32 internally; converted to PCM16 only at export time.
  encoding: 'pcm-f32',
};

export const EXPORT_FORMAT: AudioFormat = {
  sampleRate: 16_000,
  channels: 1,
  bitDepth: 16,
  encoding: 'pcm-s16le',
};

export const FRAME_DURATION_MS = 20;
export const FRAME_SAMPLE_COUNT = Math.round((CAPTURE_FORMAT.sampleRate * FRAME_DURATION_MS) / 1000);

/** Converts Float32 [-1,1] samples to a PCM16LE Buffer-compatible Int16Array. */
export function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/** Naive linear-interpolation downsampler — adequate for 48kHz -> 16kHz speech audio. */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const srcIndex = i * ratio;
    const lower = Math.floor(srcIndex);
    const upper = Math.min(lower + 1, samples.length - 1);
    const frac = srcIndex - lower;
    result[i] = samples[lower] * (1 - frac) + samples[upper] * frac;
  }
  return result;
}
