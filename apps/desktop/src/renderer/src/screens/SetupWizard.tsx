import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TranslationMode } from '@kvl/shared';
import { Badge, Button, Card, Radio, Toggle } from '@kvl/ui';
import { useAudioCaptureManager } from '../hooks/useAudioCaptureManager';
import { AudioPermissionManager, type PermissionState } from '../audio/AudioPermissionManager';
import type { MicDeviceInfo } from '../audio/AudioDeviceManager';
import { useMeetingStore } from '../state/meetingStore';
import { useTranslatorUiStore } from '../state/translatorUiStore';
import { LivePanels } from '../components/translator/LivePanels';
import { ApiProviders } from './ApiProviders';
import { onSettingsData, send } from '../services/wsClient';

type StepId = 'welcome' | 'audio-setup' | 'mic-test' | 'system-audio-setup' | 'language-setup' | 'provider-setup' | 'privacy-setup' | 'shortcuts' | 'test-meeting' | 'complete';

const STEPS: { id: StepId; title: string }[] = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'audio-setup', title: 'Audio Setup' },
  { id: 'mic-test', title: 'Microphone Test' },
  { id: 'system-audio-setup', title: 'System Audio Setup' },
  { id: 'language-setup', title: 'Language Setup' },
  { id: 'provider-setup', title: 'Provider Setup' },
  { id: 'privacy-setup', title: 'Privacy Setup' },
  { id: 'shortcuts', title: 'Keyboard Shortcuts' },
  { id: 'test-meeting', title: 'Test Meeting' },
  { id: 'complete', title: 'Complete' },
];

const CAPTURE_MODE_LABEL = { system: 'System audio only', microphone: 'Microphone only', both: 'System + Microphone' } as const;
const TRANSLATION_MODE_LABEL: Record<TranslationMode, string> = {
  hindi: 'Hindi (Devanagari)',
  hinglish: 'Hinglish (casual, romanized)',
  'simple-hindi': 'Simple Hindi',
  'simple-english': 'Simple English',
};
const TRANSLATION_MODES: TranslationMode[] = ['hinglish', 'hindi', 'simple-hindi', 'simple-english'];

const SHORTCUT_LABEL: Record<string, string> = {
  startCapture: 'Start capture',
  pauseCapture: 'Pause capture',
  stopCapture: 'Stop capture',
  muteMicrophone: 'Mute microphone',
  toggleWindow: 'Show/hide main window',
  toggleMiniWindow: 'Show/hide floating mini window',
  toggleAlwaysOnTop: 'Toggle mini window always-on-top',
  toggleInteraction: 'Toggle click-through (mini window)',
  cycleMiniMode: 'Cycle mini window mode',
  toggleTranslationPause: 'Pause/resume translation',
  toggleResponsePanel: 'Show/hide Suggested Reply panel',
};

function LevelMeter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border/20">
      <div className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-75" style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

function StepShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Phase 15's 10-step first-run wizard. Reuses the real underlying
 * mechanisms wherever a step overlaps an existing screen (useAudioCaptureManager
 * for device/permission/level-meter logic, <ApiProviders /> verbatim for the
 * provider step, the same settings:get/settings:update WS protocol for
 * privacy, the real session:start/audio.start() pipeline for the test
 * meeting) instead of reimplementing any of it.
 */
export function SetupWizard() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }
  async function finish() {
    await window.kvlAPI.markFirstRunComplete();
    navigate('/', { replace: true });
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center overflow-y-auto bg-background px-6 py-10 text-foreground">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>
            Step {stepIndex + 1} of {STEPS.length} — {step.title}
          </span>
          {step.id !== 'welcome' && step.id !== 'complete' && (
            <button className="text-muted underline hover:text-foreground" onClick={goNext}>
              Skip this step
            </button>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/20">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>

        <Card className="flex flex-col gap-5 p-6">
          {step.id === 'welcome' && <WelcomeStep />}
          {step.id === 'audio-setup' && <AudioSetupStep />}
          {step.id === 'mic-test' && <MicTestStep />}
          {step.id === 'system-audio-setup' && <SystemAudioSetupStep />}
          {step.id === 'language-setup' && <LanguageSetupStep />}
          {step.id === 'provider-setup' && <ApiProviders />}
          {step.id === 'privacy-setup' && <PrivacySetupStep />}
          {step.id === 'shortcuts' && <ShortcutsStep />}
          {step.id === 'test-meeting' && <TestMeetingStep />}
          {step.id === 'complete' && <CompleteStep />}
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0}>
            Back
          </Button>
          {step.id === 'complete' ? (
            <Button variant="gold" onClick={finish}>
              Finish Setup
            </Button>
          ) : (
            <Button variant="gold" onClick={goNext}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep() {
  return (
    <StepShell title="Welcome to KVL Live Translator" description="A few quick steps to get your microphone, system audio, language, and AI providers set up before your first meeting.">
      <ul className="flex flex-col gap-2 text-[13px] text-muted">
        <li>• Audio and microphone are configured on THIS device only — nothing is uploaded during setup.</li>
        <li>• Raw meeting audio is never saved to disk, in this app or during setup.</li>
        <li>• AI provider keys are optional — everything works with free/local providers, cloud keys just improve quality.</li>
      </ul>
    </StepShell>
  );
}

function AudioSetupStep() {
  const audio = useAudioCaptureManager();
  const [permission, setPermission] = useState<PermissionState>('unknown');

  useEffect(() => {
    AudioPermissionManager.queryMicrophonePermission().then(setPermission);
  }, []);

  async function handleRequestPermission() {
    await audio.requestPermissions();
    setPermission(await AudioPermissionManager.queryMicrophonePermission());
  }

  return (
    <StepShell title="Audio Setup" description="Choose what KVL should capture during a meeting.">
      <div className="flex flex-col gap-2">
        {(Object.keys(CAPTURE_MODE_LABEL) as (keyof typeof CAPTURE_MODE_LABEL)[]).map((m) => (
          <Radio key={m} checked={audio.captureMode === m} onSelect={() => audio.setCaptureMode(m)} label={CAPTURE_MODE_LABEL[m]} />
        ))}
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/20 p-3">
        <div>
          <div className="text-[13px] font-semibold">Microphone permission</div>
          <div className="text-[11.5px] text-muted">Required for microphone/both modes.</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'neutral'}>{permission}</Badge>
          {permission !== 'granted' && (
            <Button variant="secondary" onClick={handleRequestPermission}>
              Grant Access
            </Button>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function MicTestStep() {
  const audio = useAudioCaptureManager();
  const [devices, setDevices] = useState<MicDeviceInfo[]>([]);
  const [testId] = useState(() => randomId('setup-mic-test'));

  useEffect(() => {
    audio.getDevices().then(setDevices);
    return audio.manager.onDevicesChanged(setDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTest() {
    await audio.start({ sessionId: testId, mode: 'microphone', micDeviceId: audio.selectedMicDeviceId, micDeviceLabel: audio.selectedMicLabel });
  }
  async function handleStop() {
    await audio.stop();
  }

  return (
    <StepShell title="Microphone Test" description="Pick your microphone and speak — the meter below should move.">
      <select
        className="rounded-md border border-border/30 bg-surface px-3 py-2 text-[13px] text-foreground"
        value={audio.selectedMicDeviceId ?? ''}
        onChange={(e) => {
          const device = devices.find((d) => d.deviceId === e.target.value);
          audio.selectMic(e.target.value || undefined, device?.label);
        }}
      >
        <option value="">Default Device</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <LevelMeter value={audio.micLevels.normalized} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleTest} disabled={audio.engineState === 'capturing'}>
          Test Microphone
        </Button>
        <Button variant="ghost" onClick={handleStop} disabled={audio.engineState !== 'capturing'}>
          Stop
        </Button>
      </div>
      {audio.lastError && <p className="text-[11.5px] text-danger">{audio.lastError}</p>}
    </StepShell>
  );
}

function SystemAudioSetupStep() {
  const audio = useAudioCaptureManager();
  const [testId] = useState(() => randomId('setup-system-test'));

  async function handleTest() {
    await audio.start({ sessionId: testId, mode: 'system' });
  }
  async function handleStop() {
    await audio.stop();
  }

  return (
    <StepShell title="System Audio Setup" description="Lets KVL hear the other meeting participants (e.g. through Zoom/Meet), not just your microphone.">
      <LevelMeter value={audio.systemLevels.normalized} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleTest} disabled={audio.engineState === 'capturing'}>
          Test System Audio
        </Button>
        <Button variant="ghost" onClick={handleStop} disabled={audio.engineState !== 'capturing'}>
          Stop
        </Button>
      </div>
      {audio.lastError && <p className="text-[11.5px] text-danger">{audio.lastError}</p>}
      <p className="text-[11.5px] text-muted">
        System audio capture requires OS-level screen/audio-recording permission on macOS, and works out of the box on
        most Windows/Linux setups. If the meter above never moves while audio is playing, check your OS's screen
        recording permission for KVL Live Translator.
      </p>
    </StepShell>
  );
}

function LanguageSetupStep() {
  const { mode, setMode } = useMeetingStore();
  return (
    <StepShell title="Language Setup" description="How translated meeting speech should be shown by default. You can change this anytime from the Meeting Translator screen.">
      <div className="flex flex-col gap-2">
        {TRANSLATION_MODES.map((m) => (
          <Radio key={m} checked={mode === m} onSelect={() => setMode(m)} label={TRANSLATION_MODE_LABEL[m]} />
        ))}
      </div>
    </StepShell>
  );
}

interface PrivacyWizardSettings {
  saveTranscript?: boolean;
  localOnlyMode?: boolean;
  ttsOfflineOnly?: boolean;
}

function PrivacySetupStep() {
  const [settings, setSettings] = useState<PrivacyWizardSettings>({});

  useEffect(() => {
    const unsub = onSettingsData((message) => setSettings(message.settings as PrivacyWizardSettings));
    send({ type: 'settings:get' });
    return unsub;
  }, []);

  function updateSetting<K extends keyof PrivacyWizardSettings>(key: K, value: PrivacyWizardSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    send({ type: 'settings:update', patch: { [key]: value } });
  }

  return (
    <StepShell title="Privacy Setup" description="These are the same settings available later under Settings — Privacy.">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Do not save raw meeting audio</div>
          <div className="text-[11.5px] text-muted">Always on — never written to disk in this app.</div>
        </div>
        <Toggle checked disabled onChange={() => {}} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Save transcript</div>
          <div className="text-[11.5px] text-muted">Needed to generate a Meeting Summary later.</div>
        </div>
        <Toggle checked={settings.saveTranscript ?? true} onChange={(v) => updateSetting('saveTranscript', v)} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Local-Only Mode</div>
          <div className="text-[11.5px] text-muted">Never send meeting content to any cloud provider.</div>
        </div>
        <Toggle checked={settings.localOnlyMode ?? false} onChange={(v) => updateSetting('localOnlyMode', v)} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Offline-only voice responses</div>
          <div className="text-[11.5px] text-muted">"Speak" only ever uses Local/Browser voices, never Cloud.</div>
        </div>
        <Toggle checked={settings.ttsOfflineOnly ?? false} onChange={(v) => updateSetting('ttsOfflineOnly', v)} />
      </div>
    </StepShell>
  );
}

function ShortcutsStep() {
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});

  useEffect(() => {
    window.kvlAPI.getDefaultShortcuts().then(setShortcuts);
  }, []);

  return (
    <StepShell title="Keyboard Shortcuts" description="These work globally, even when KVL isn't the focused window.">
      <div className="flex flex-col gap-1.5">
        {Object.entries(shortcuts).map(([action, accelerator]) => (
          <div key={action} className="flex items-center justify-between border-b border-border/10 py-1.5 text-[12.5px] last:border-b-0">
            <span>{SHORTCUT_LABEL[action] ?? action}</span>
            <code className="rounded bg-surface-tint px-2 py-0.5 text-[11.5px] text-foreground">{accelerator}</code>
          </div>
        ))}
      </div>
    </StepShell>
  );
}

function TestMeetingStep() {
  const { sessionId, isActive, transcript, translations, mode } = useMeetingStore();
  const audio = useAudioCaptureManager();
  const ui = useTranslatorUiStore();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const activeSessionId = sessionId ?? pendingSessionId;

  async function handleStart() {
    const id = randomId('setup-test-meeting');
    setPendingSessionId(id);
    send({ type: 'session:start', sessionId: id, mode, captureMode: audio.captureMode, micDeviceLabel: audio.selectedMicLabel });
    await audio.start({ sessionId: id, mode: audio.captureMode, micDeviceId: audio.selectedMicDeviceId, micDeviceLabel: audio.selectedMicLabel, testMode: audio.testMode });
  }
  async function handleEnd() {
    if (!activeSessionId) return;
    send({ type: 'session:end', sessionId: activeSessionId });
    await audio.stop();
    setPendingSessionId(null);
  }

  return (
    <StepShell title="Test Meeting" description="Start a short real session and speak — you should see a live transcript and translation below, using the exact same pipeline as a real meeting.">
      <div className="flex gap-2">
        <Button variant="gold" onClick={handleStart} disabled={isActive}>
          Start Test Session
        </Button>
        <Button variant="danger" onClick={handleEnd} disabled={!isActive}>
          End Test Session
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border/20 p-2">
        <LivePanels
          transcript={transcript}
          translations={translations}
          translationModeLabel={TRANSLATION_MODE_LABEL[mode] ?? mode}
          fontSize={ui.fontSize}
          autoScroll={ui.autoScroll}
          compact={false}
          showOriginal={ui.showOriginal}
          onToggleShowOriginal={ui.toggleShowOriginal}
        />
      </div>
    </StepShell>
  );
}

function CompleteStep() {
  return (
    <StepShell title="You're all set" description="KVL Live Translator is ready. You can revisit any of this setup later from Settings.">
      <p className="text-[13px] text-muted">Click "Finish Setup" to start using the app.</p>
    </StepShell>
  );
}
