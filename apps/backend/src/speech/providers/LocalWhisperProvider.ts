import { spawn } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechInputChunk, SpeechProvider, SpeechProviderCapabilities, SpeechProviderConfig, SpeechProviderStatus, SpeechTranscriptionResult } from '@kvl/speech';
import { config } from '../../config';
import { pcm16ToWav } from '../wavEncoder';
import { childLogger } from '../../logger';

const log = childLogger('local-whisper');
const TRANSCRIBE_TIMEOUT_MS = 30_000;

/** Shape of whisper.cpp's `--output-json` file. May need adjusting for a
 * given whisper.cpp build/version — not verifiable against a real binary in
 * this environment, so this is a best-effort parse with defensive fallbacks. */
interface WhisperCliJsonOutput {
  result?: { language?: string };
  transcription?: Array<{ text: string }>;
}

function runWhisperCli(binaryPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args);
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('whisper.cpp process timed out'));
    }, TRANSCRIBE_TIMEOUT_MS);

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`whisper.cpp exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

/**
 * Runs a configured whisper.cpp CLI binary against each speech chunk
 * (written to a temp WAV file, matching Phase 2's 16kHz mono PCM16 export
 * format exactly — no resampling needed). Availability is a real runtime
 * check (binary + model both exist and are accessible), never assumed.
 */
export class LocalWhisperProvider implements SpeechProvider {
  readonly id = 'local-whisper';
  readonly displayName = 'Local Whisper (whisper.cpp)';

  private status: SpeechProviderStatus = 'unavailable';
  private binaryPath: string | undefined;
  private modelPath: string | undefined;
  private available = false;

  async start(_speechConfig: SpeechProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.binaryPath = config.WHISPER_CPP_BINARY_PATH;
    this.modelPath = config.WHISPER_CPP_MODEL_PATH;
    this.available = await this.checkAvailability();
    this.status = this.available ? 'ready' : 'unavailable';
    if (!this.available) {
      log.warn(
        { binaryPath: this.binaryPath, modelPath: this.modelPath },
        'LocalWhisperProvider unavailable — set WHISPER_CPP_BINARY_PATH/WHISPER_CPP_MODEL_PATH to enable',
      );
    }
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
    this.available = false;
  }

  private async checkAvailability(): Promise<boolean> {
    if (!this.binaryPath || !this.modelPath) return false;
    try {
      await access(this.binaryPath, constants.X_OK);
      await access(this.modelPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async transcribe(chunk: SpeechInputChunk): Promise<SpeechTranscriptionResult> {
    if (!this.available || !this.binaryPath || !this.modelPath) {
      throw new Error('LocalWhisperProvider is not available');
    }

    this.status = 'busy';
    let tmpDir: string | undefined;
    try {
      const wav = pcm16ToWav(chunk.audio, { sampleRate: chunk.sampleRateHz, channels: chunk.channelCount, bitDepth: 16 });
      tmpDir = await mkdtemp(join(tmpdir(), 'kvl-whisper-'));
      const wavPath = join(tmpDir, `${chunk.chunkId}.wav`);
      const outPrefix = join(tmpDir, chunk.chunkId);
      await writeFile(wavPath, wav);

      await runWhisperCli(this.binaryPath, ['-m', this.modelPath, '-f', wavPath, '-oj', '-of', outPrefix, '-nt']);

      const raw = await readFile(`${outPrefix}.json`, 'utf-8');
      const parsed = JSON.parse(raw) as WhisperCliJsonOutput;
      const text = (parsed.transcription ?? []).map((segment) => segment.text).join(' ').trim();

      return {
        text,
        languageCode: parsed.result?.language, // never hardcode 'en' — report whatever whisper.cpp auto-detected
        isFinal: true,
      };
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  getStatus(): SpeechProviderStatus {
    return this.status;
  }

  getCapabilities(): SpeechProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      streaming: false,
      offline: true,
      supportedLanguages: ['auto'],
      requiresApiKey: false,
    };
  }
}
