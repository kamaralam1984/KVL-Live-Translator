import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsProvider, TtsProviderCapabilities, TtsProviderConfig, TtsProviderStatus, TtsRequest, TtsResult, VoiceInfo } from '@kvl/tts';
import { config } from '../../config';
import { childLogger } from '../../logger';

const log = childLogger('local-tts');
const SYNTHESIZE_TIMEOUT_MS = 20_000;
const MAX_TEXT_LENGTH = 5_000; // generous — espeak-ng has no hard cap, but keep synthesis bounded

function runCli(binaryPath: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args);
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('espeak-ng process timed out'));
    }, SYNTHESIZE_TIMEOUT_MS);

    proc.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout });
      else reject(new Error(`espeak-ng exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

/**
 * Wraps a local espeak-ng CLI installation — offline, no model download
 * needed (unlike whisper.cpp), same spirit as ArgosTranslateProvider's
 * python3 dependency check. Availability is a real subprocess check
 * (`espeak-ng --version` succeeding), never assumed. Writes to a temp WAV
 * file and deletes it immediately after reading — never persists generated
 * audio (see the Phase 7 plan's privacy requirement).
 */
export class LocalTtsProvider implements TtsProvider {
  readonly id = 'local-espeak';
  readonly displayName = 'Local (espeak-ng)';
  readonly tier = 'local' as const;

  private status: TtsProviderStatus = 'unavailable';
  private available = false;

  async start(_ttsConfig: TtsProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.available = await this.checkAvailability();
    this.status = this.available ? 'ready' : 'unavailable';
    if (!this.available) {
      log.warn({ binaryPath: config.ESPEAK_BINARY_PATH }, 'LocalTtsProvider unavailable — install espeak-ng or set ESPEAK_BINARY_PATH');
    }
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
    this.available = false;
  }

  private async checkAvailability(): Promise<boolean> {
    try {
      await runCli(config.ESPEAK_BINARY_PATH, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (!this.available) throw new Error('LocalTtsProvider is not available');
    if (request.text.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text too long for LocalTtsProvider (${request.text.length} > ${MAX_TEXT_LENGTH} characters)`);
    }

    this.status = 'busy';
    let tmpDir: string | undefined;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'kvl-tts-'));
      const wavPath = join(tmpDir, 'out.wav');

      const args = ['-w', wavPath];
      if (request.voiceId) args.push('-v', request.voiceId);
      if (request.speed) args.push('-s', String(Math.round(clampSpeed(request.speed) * 175))); // espeak-ng's -s is words/min; 175 ≈ its default "1.0x"
      args.push(request.text);

      await runCli(config.ESPEAK_BINARY_PATH, args);
      const audio = await readFile(wavPath);

      return { audio, mimeType: 'audio/wav' };
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  /** Best-effort parse of `espeak-ng --voices` — column layout is
   * space-separated and not guaranteed stable across versions (same caveat
   * as LocalWhisperProvider's JSON-output parsing), so this defensively
   * returns whatever it can parse rather than throwing on an unexpected
   * format. */
  async getVoices(): Promise<VoiceInfo[]> {
    if (!this.available) return [];
    try {
      const { stdout } = await runCli(config.ESPEAK_BINARY_PATH, ['--voices']);
      const voices: VoiceInfo[] = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim() || line.trim().startsWith('Pty')) continue;
        const match = line.match(/^\s*\d+\s+(\S+)\s+\S+\s+(.+?)\s{2,}\S+/);
        if (!match) continue;
        const [, languageCode, name] = match;
        voices.push({ id: name.trim(), name: name.trim(), languageCode });
      }
      return voices;
    } catch (error) {
      log.warn({ err: error }, 'could not list espeak-ng voices');
      return [];
    }
  }

  getStatus(): TtsProviderStatus {
    return this.status;
  }

  getCapabilities(): TtsProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
      maxTextLength: MAX_TEXT_LENGTH,
    };
  }
}

function clampSpeed(speed: number): number {
  return Math.max(0.5, Math.min(2, speed));
}
