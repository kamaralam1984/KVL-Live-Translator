import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, StatusPill, Toggle } from '@kvl/ui';
import { useAudioCaptureManager } from '../hooks/useAudioCaptureManager';
import { useAudioStore } from '../state/audioStore';
import { useConnectionStore } from '../state/connectionStore';
import { AudioPermissionManager, type PermissionState } from '../audio/AudioPermissionManager';
import { runAudioDiagnostic, type DiagnosticCheck } from '../audio/AudioDiagnostics';
import type { AppPlatform } from '../audio/types';
import type { MicDeviceInfo } from '../audio/AudioDeviceManager';

function randomTestId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function LevelMeter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border/20">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-75"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

const statusToPillState: Record<string, 'idle' | 'connecting' | 'connected' | 'listening' | 'error'> = {
  idle: 'idle',
  connecting: 'connecting',
  listening: 'listening',
  paused: 'idle',
  error: 'error',
  unavailable: 'error',
  reconnecting: 'connecting',
};

export function AudioDiagnostics() {
  const audio = useAudioCaptureManager();
  const backendStatus = useConnectionStore((s) => s.status);
  const setTestMode = useAudioStore((s) => s.setTestMode);
  const selectMic = useAudioStore((s) => s.selectMic);

  const [devices, setDevices] = useState<MicDeviceInfo[]>([]);
  const [platform, setPlatform] = useState<AppPlatform>('unknown');
  const [micPermission, setMicPermission] = useState<PermissionState>('unknown');
  const [report, setReport] = useState<DiagnosticCheck[] | null>(null);

  useEffect(() => {
    audio.getDevices().then(setDevices);
    window.kvlAPI.getPlatform().then((p) => setPlatform((['darwin', 'linux', 'win32'].includes(p) ? p : 'unknown') as AppPlatform));
    AudioPermissionManager.queryMicrophonePermission().then(setMicPermission);
    return audio.manager.onDevicesChanged(setDevices);
  }, []);

  const testId = useMemo(() => randomTestId('diagnostics'), []);

  function handleRunDiagnostic() {
    setReport(
      runAudioDiagnostic({
        platform,
        micPermission,
        micAvailable: devices.length > 0,
        systemAudioAvailable: audio.systemStatus === 'listening' ? true : audio.systemStatus === 'error' ? false : 'unknown',
        vadState: audio.vadState,
        bufferedMs: 0,
        droppedFrames: audio.droppedFrames,
        backendConnected: backendStatus === 'connected',
      }),
    );
  }

  async function handleTestMicrophone() {
    await audio.start({ sessionId: testId, mode: 'microphone', micDeviceId: audio.selectedMicDeviceId, micDeviceLabel: audio.selectedMicLabel });
  }

  async function handleTestSystemAudio() {
    await audio.start({ sessionId: testId, mode: 'system' });
  }

  async function handleStartCapture() {
    await audio.start({
      sessionId: testId,
      mode: audio.captureMode,
      micDeviceId: audio.selectedMicDeviceId,
      micDeviceLabel: audio.selectedMicLabel,
      testMode: audio.testMode,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Audio Diagnostics</h1>
        <p className="mt-1 text-[13px] text-muted">Test capture devices and inspect the audio pipeline before a meeting.</p>
      </div>

      {audio.testMode && (
        <Badge variant="warning" className="w-fit">
          TEST MODE — synthetic audio, not a real meeting
        </Badge>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Audio Input Test</h4>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold">System Audio</span>
              <StatusPill label={audio.systemStatus} state={statusToPillState[audio.systemStatus]} />
            </div>
            <LevelMeter value={audio.systemLevels.normalized} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold">Microphone</span>
              <StatusPill label={audio.micStatus} state={statusToPillState[audio.micStatus]} />
            </div>
            <LevelMeter value={audio.micLevels.normalized} />
          </div>

          <select
            className="rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
            value={audio.selectedMicDeviceId ?? ''}
            onChange={(e) => {
              const device = devices.find((d) => d.deviceId === e.target.value);
              selectMic(e.target.value || undefined, device?.label);
            }}
          >
            <option value="">Default Device</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
                {d.looksLikeSystemMonitor ? ' (system monitor)' : ''}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleTestMicrophone}>
              Test Microphone
            </Button>
            <Button variant="secondary" onClick={handleTestSystemAudio}>
              Test System Audio
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/20 px-3 py-2">
            <span className="text-[12px]">Test Mode (synthetic signal, no hardware needed)</span>
            <Toggle checked={audio.testMode} onChange={setTestMode} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="gold" onClick={handleStartCapture} disabled={audio.engineState === 'capturing'}>
              Start Capture
            </Button>
            <Button
              variant="secondary"
              onClick={() => (audio.engineState === 'paused' ? audio.resume() : audio.pause())}
              disabled={audio.engineState !== 'capturing' && audio.engineState !== 'paused'}
            >
              {audio.engineState === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="danger" onClick={() => audio.stop()} disabled={audio.engineState === 'idle' || audio.engineState === 'stopped'}>
              Stop
            </Button>
          </div>

          {audio.lastError && <p className="text-[11.5px] text-danger">{audio.lastError}</p>}
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Diagnostics Report</h4>
            <Button variant="secondary" onClick={handleRunDiagnostic}>
              Run Audio Diagnostic
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted">
            <span>Operating System</span>
            <span className="text-foreground">{platform}</span>
            <span>Sample Rate</span>
            <span className="text-foreground">48,000 Hz → 16,000 Hz export</span>
            <span>Engine State</span>
            <span className="text-foreground">{audio.engineState}</span>
            <span>VAD State</span>
            <span className="text-foreground">{audio.vadState}</span>
            <span>Chunks Emitted</span>
            <span className="text-foreground">{audio.chunksEmitted}</span>
            <span>Dropped Frames</span>
            <span className="text-foreground">{audio.droppedFrames}</span>
          </div>

          {report && (
            <ul className="flex flex-col gap-1.5 border-t border-border/20 pt-3">
              {report.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-[12.5px]">
                  <span>{check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗'}</span>
                  <div>
                    <span className="font-semibold">{check.label}</span>
                    {check.detail && <p className="text-[11.5px] text-muted">{check.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
