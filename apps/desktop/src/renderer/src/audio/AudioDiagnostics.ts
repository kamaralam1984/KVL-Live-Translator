import type { AppPlatform, VadState } from './types';
import type { PermissionState } from './AudioPermissionManager';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail?: string;
}

export interface DiagnosticInput {
  platform: AppPlatform;
  micPermission: PermissionState;
  micAvailable: boolean;
  systemAudioAvailable: boolean | 'unknown';
  vadState: VadState | 'unknown';
  bufferedMs: number;
  droppedFrames: number;
  backendConnected: boolean;
}

/**
 * Pure function producing the ✓/⚠ diagnostic report (spec §33). DOM-free —
 * the UI screen gathers the live input values, this just judges them, so
 * the judging logic itself stays unit-testable.
 */
export function runAudioDiagnostic(input: DiagnosticInput): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  checks.push({
    id: 'microphone',
    label: 'Microphone',
    status: input.micAvailable && input.micPermission === 'granted' ? 'pass' : input.micPermission === 'denied' ? 'fail' : 'warn',
    detail:
      input.micPermission === 'denied'
        ? 'Microphone permission denied — open system settings to allow it.'
        : !input.micAvailable
          ? 'No microphone detected.'
          : undefined,
  });

  checks.push({
    id: 'audio-engine',
    label: 'Audio Engine',
    status: input.vadState !== 'unknown' ? 'pass' : 'warn',
    detail: input.vadState === 'unknown' ? 'Engine not initialized yet — start a test capture.' : undefined,
  });

  checks.push({
    id: 'vad',
    label: 'Voice Activity Detection',
    status: input.vadState !== 'unknown' ? 'pass' : 'warn',
  });

  checks.push({
    id: 'buffer',
    label: 'Buffer',
    status: input.droppedFrames === 0 ? 'pass' : input.droppedFrames < 50 ? 'warn' : 'fail',
    detail: input.droppedFrames > 0 ? `${input.droppedFrames} frame(s) dropped due to backpressure.` : undefined,
  });

  checks.push({
    id: 'system-audio',
    label: 'System Audio',
    status: input.systemAudioAvailable === true ? 'pass' : input.systemAudioAvailable === 'unknown' ? 'warn' : 'fail',
    detail: input.systemAudioAvailable !== true ? 'System audio requires additional configuration on this platform — see the setup guide.' : undefined,
  });

  checks.push({
    id: 'backend',
    label: 'Backend Connection',
    status: input.backendConnected ? 'pass' : 'fail',
  });

  return checks;
}
