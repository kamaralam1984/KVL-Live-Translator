import { spawn } from 'node:child_process';
import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderConfig,
  TranslationProviderStatus,
  TranslationRequest,
  TranslationResult,
} from '@kvl/translation';
import { applyHinglishIfRequested } from '../transliterate';
import { childLogger } from '../../logger';

const log = childLogger('argos-translate');
const TRANSLATE_TIMEOUT_MS = 45_000;
const PYTHON_BIN = process.env.ARGOS_PYTHON_BIN || 'python3';

function runPython(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, args);
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('argostranslate process timed out'));
    }, TRANSLATE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`argostranslate exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });

    if (input !== undefined) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/**
 * Wraps a local Argos Translate Python installation (offline NMT, similar
 * spirit to whisper.cpp for STT). Availability is a real subprocess check
 * (`python3 -c "import argostranslate.translate"`), not assumed — matches
 * LocalWhisperProvider's pattern in Phase 3.
 */
export class ArgosTranslateProvider implements TranslationProvider {
  readonly id = 'argos-translate';
  readonly displayName = 'Argos Translate (offline)';
  readonly tier = 'local' as const;

  private status: TranslationProviderStatus = 'unavailable';
  private available = false;

  async start(_config: TranslationProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.available = await this.checkAvailability();
    this.status = this.available ? 'ready' : 'unavailable';
    if (!this.available) {
      log.warn('ArgosTranslateProvider unavailable — install the argostranslate Python package to enable');
    }
  }

  async stop(): Promise<void> {
    this.status = 'unavailable';
    this.available = false;
  }

  private async checkAvailability(): Promise<boolean> {
    try {
      await runPython(['-c', 'import argostranslate.translate']);
      return true;
    } catch {
      return false;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (!this.available) throw new Error('ArgosTranslateProvider is not available');

    this.status = 'busy';
    try {
      const script = [
        'import sys, json, argostranslate.translate',
        'text = sys.stdin.read()',
        `result = argostranslate.translate.translate(text, "${request.sourceLang}", "${request.targetLang}")`,
        'print(json.dumps({"text": result}))',
      ].join('\n');

      const stdout = await runPython(['-c', script], request.text);
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { text?: string };
      const hindiText = parsed.text ?? '';

      return { translatedText: applyHinglishIfRequested(hindiText, request.mode) };
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  getStatus(): TranslationProviderStatus {
    return this.status;
  }

  getCapabilities(): TranslationProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
      supportedModes: ['hindi', 'hinglish'],
    };
  }
}
