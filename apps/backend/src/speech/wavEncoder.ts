export interface WavFormat {
  sampleRate: number;
  channels: number;
  /** Bits per sample — this encoder only supports 16 (matches Phase 2's PCM16LE export format). */
  bitDepth: 16;
}

/**
 * Wraps a raw PCM16LE buffer in a standard 44-byte WAV header. Pure
 * function — no I/O — so it's directly unit-testable. Both LocalWhisperProvider
 * (whisper.cpp CLI expects a WAV file) and CloudSpeechProvider (multipart WAV
 * upload) share this.
 */
export function pcm16ToWav(pcm: Buffer, format: WavFormat): Buffer {
  const { sampleRate, channels, bitDepth } = format;
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
