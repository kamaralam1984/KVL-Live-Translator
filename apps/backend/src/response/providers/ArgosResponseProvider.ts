import { spawn } from 'node:child_process';
import type {
  ResponseProvider,
  ResponseProviderCapabilities,
  ResponseProviderConfig,
  ResponseProviderStatus,
  ResponseRequest,
  ResponseResult,
} from '@kvl/response';
import { childLogger } from '../../logger';

const log = childLogger('argos-response');
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
 * Wraps a local Argos Translate Python installation, hi->en direction —
 * same package family as ArgosTranslateProvider.ts (Phase 4) but needs the
 * reverse-direction language package installed. Availability is a real
 * subprocess check, not assumed. Only claims the 'professional' style — a
 * plain NMT engine can't genuinely restyle (see the Phase 6 plan).
 */
export class ArgosResponseProvider implements ResponseProvider {
  readonly id = 'argos-response';
  readonly displayName = 'Argos Translate (offline)';
  readonly tier = 'local' as const;

  private status: ResponseProviderStatus = 'unavailable';
  private available = false;

  async start(_config: ResponseProviderConfig): Promise<void> {
    this.status = 'initializing';
    this.available = await this.checkAvailability();
    this.status = this.available ? 'ready' : 'unavailable';
    if (!this.available) {
      log.warn('ArgosResponseProvider unavailable — install the argostranslate Python package (with a hi->en language package) to enable');
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

  async generate(request: ResponseRequest): Promise<ResponseResult> {
    if (!this.available) throw new Error('ArgosResponseProvider is not available');

    this.status = 'busy';
    try {
      const script = ['import sys, json, argostranslate.translate', 'text = sys.stdin.read()', 'result = argostranslate.translate.translate(text, "hi", "en")', 'print(json.dumps({"text": result}))'].join('\n');

      const stdout = await runPython(['-c', script], request.text);
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { text?: string };

      return { englishText: parsed.text ?? '' };
    } finally {
      this.status = this.available ? 'ready' : 'unavailable';
    }
  }

  getStatus(): ResponseProviderStatus {
    return this.status;
  }

  getCapabilities(): ResponseProviderCapabilities {
    return {
      id: this.id,
      displayName: this.displayName,
      available: this.available,
      offline: true,
      requiresApiKey: false,
      tier: this.tier,
      supportedStyles: ['professional'],
    };
  }
}
