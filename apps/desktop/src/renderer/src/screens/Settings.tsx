import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CostMode } from '@kvl/shared';
import { Badge, Button, Card, Toggle } from '@kvl/ui';
import { onHistoryData, onSettingsData, send } from '../services/wsClient';
import { useTtsStore } from '../state/ttsStore';
import { ttsRouter } from '../tts/TTSRouter';
import { useMeetingStore } from '../state/meetingStore';
import type { UpdateCheckResult } from '../../../preload/index';

type TranscriptRetentionPolicy = 'session' | '1day' | '7days' | '30days' | 'never';

interface AppSettings {
  autoStartSession?: boolean;
  desktopNotifications?: boolean;
  saveTranscript?: boolean;
  allowTemporaryProcessing?: boolean;
  ttsOfflineOnly?: boolean;
  saveSummary?: boolean;
  costMode?: CostMode;
  monthlyBudgetUsd?: number;
  localOnlyMode?: boolean;
  enableCaching?: boolean;
  transcriptRetentionPolicy?: TranscriptRetentionPolicy;
}

const COST_MODE_LABEL: Record<CostMode, string> = {
  economy: 'Economy — local/free only, never call a paid provider',
  balanced: 'Balanced — call a paid provider only when local/free isn’t good enough',
  quality: 'Quality — always check the paid provider too, keep the best result',
};
const BUDGET_PRESETS_USD = [0, 5, 25, 50, 100];
const RETENTION_LABEL: Record<TranscriptRetentionPolicy, string> = {
  never: 'Never — keep transcripts until you delete a meeting yourself (default)',
  '30days': 'Auto-delete after 30 days',
  '7days': 'Auto-delete after 7 days',
  '1day': 'Auto-delete after 1 day',
  session: 'Auto-delete the moment the meeting ends (most private — the AI Summary\'s 4 synthesized fields need the raw transcript, so generate a summary before ending the session if you want one; the 7 confirmed-fact sections still work fine without it)',
};
const RETENTION_ORDER: TranscriptRetentionPolicy[] = ['never', '30days', '7days', '1day', 'session'];

interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

export function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>({});
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState('default');
  const [customBudget, setCustomBudget] = useState('');
  const [cacheCleared, setCacheCleared] = useState(false);
  const setOfflineOnly = useTtsStore((s) => s.setOfflineOnly);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const isMeetingActive = useMeetingStore((s) => s.isActive);

  useEffect(() => {
    const unsubSettings = onSettingsData((message) => {
      const data = message.settings as AppSettings;
      setSettings(data);
      setOfflineOnly(data.ttsOfflineOnly ?? false);
    });
    const unsubHistory = onHistoryData(() => {
      setDeletedNotice(true);
      setDeleteConfirm(false);
    });
    send({ type: 'settings:get' });
    window.kvlAPI.getAppVersion().then(setAppVersion);

    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) =>
        setOutputDevices(
          devices.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || `Output device (${d.deviceId.slice(0, 8)})` })),
        ),
      )
      .catch(() => setOutputDevices([]));

    return () => {
      unsubSettings();
      unsubHistory();
    };
  }, [setOfflineOnly]);

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    send({ type: 'settings:update', patch: { [key]: value } });
    if (key === 'ttsOfflineOnly') setOfflineOnly(Boolean(value));
  }

  function handleClearCache() {
    send({ type: 'cache:clear' });
    setCacheCleared(true);
  }

  async function handleOutputDeviceChange(deviceId: string) {
    setSelectedOutputDevice(deviceId);
    try {
      await ttsRouter.setOutputDevice(deviceId);
    } catch {
      // setSinkId isn't supported everywhere — the default output still works either way.
    }
  }

  function handleDeleteSessionData() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    send({ type: 'history:clear' });
  }

  async function handleRedoSetupWizard() {
    await window.kvlAPI.resetFirstRun();
    navigate('/setup');
  }

  async function handleCheckForUpdate() {
    if (isMeetingActive) return; // never checks during an active meeting
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const result = await window.kvlAPI.checkForUpdate();
      setUpdateResult(result);
    } finally {
      setCheckingUpdate(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="mt-1 text-[13px] text-muted">General application preferences, stored locally.</p>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Auto-start session on meeting detect</div>
            <div className="text-[11.5px] text-muted">Not yet implemented — placeholder for a later phase</div>
          </div>
          <Toggle checked={settings.autoStartSession ?? false} onChange={(v) => updateSetting('autoStartSession', v)} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Desktop notifications</div>
            <div className="text-[11.5px] text-muted">Show a notification when a session ends</div>
          </div>
          <Toggle checked={settings.desktopNotifications ?? true} onChange={(v) => updateSetting('desktopNotifications', v)} />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h4 className="text-[13px] font-bold">Privacy</h4>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Do not save raw meeting audio</div>
            <div className="text-[11.5px] text-muted">
              Always on — raw audio is never written to disk; captured frames are discarded once chunked.
            </div>
          </div>
          <Toggle checked disabled onChange={() => {}} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Save transcript</div>
            <div className="text-[11.5px] text-muted">
              Durably keep the raw meeting transcript, needed to generate a Meeting Summary later. Off means the transcript
              only ever exists in memory during the live session.
            </div>
          </div>
          <Toggle checked={settings.saveTranscript ?? true} onChange={(v) => updateSetting('saveTranscript', v)} />
        </div>

        {(settings.saveTranscript ?? true) && (
          <div className="flex flex-col gap-1.5 pl-3">
            <div className="text-[12px] font-semibold text-muted">Transcript retention</div>
            <select
              className="rounded-md border border-border/30 bg-surface px-2 py-1.5 text-[12px] text-foreground"
              value={settings.transcriptRetentionPolicy ?? 'never'}
              onChange={(e) => updateSetting('transcriptRetentionPolicy', e.target.value as TranscriptRetentionPolicy)}
            >
              {RETENTION_ORDER.map((policy) => (
                <option key={policy} value={policy}>
                  {RETENTION_LABEL[policy]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Save summary</div>
            <div className="text-[11.5px] text-muted">Allow "Save locally" on a generated Meeting Summary to actually persist it.</div>
          </div>
          <Toggle checked={settings.saveSummary ?? true} onChange={(v) => updateSetting('saveSummary', v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Save audio</div>
            <div className="text-[11.5px] text-muted">Not implemented — this app has never recorded or persisted raw audio (see "Do not save raw meeting audio" above).</div>
          </div>
          <Toggle checked={false} disabled onChange={() => {}} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Allow temporary audio processing</div>
            <div className="text-[11.5px] text-muted">Required to run VAD/chunking during a session</div>
          </div>
          <Toggle checked={settings.allowTemporaryProcessing ?? true} onChange={(v) => updateSetting('allowTemporaryProcessing', v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Offline-only voice responses</div>
            <div className="text-[11.5px] text-muted">
              When on, "Speak" only ever uses the Local or Browser voice tier — Cloud is never attempted, so response text
              can never leave this machine for text-to-speech.
            </div>
          </div>
          <Toggle checked={settings.ttsOfflineOnly ?? false} onChange={(v) => updateSetting('ttsOfflineOnly', v)} />
        </div>

        <div className="flex items-center justify-between border-t border-border/20 pt-4">
          <div>
            <div className="text-[13px] font-semibold">Delete All Meeting Data</div>
            <div className="text-[11.5px] text-muted">
              Permanently removes every meeting — transcripts, translations, AI analysis, action items, and summaries.
              Does not touch your API provider keys or app settings. (Also available on the Security screen.)
            </div>
          </div>
          <Button variant="danger" onClick={handleDeleteSessionData}>
            {deleteConfirm ? 'Confirm delete' : 'Delete'}
          </Button>
        </div>
        {deletedNotice && <p className="text-[11.5px] text-success">All meeting data deleted.</p>}
      </Card>

      <Card className="flex flex-col gap-4">
        <h4 className="text-[13px] font-bold">Cost & Budget</h4>
        <p className="text-[11.5px] text-muted">
          Costs are estimated (not exact billing) from a per-provider rate table, tracked in USD. Local and free tiers
          always cost $0 — these controls only affect paid cloud providers.
        </p>

        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">Cost mode</div>
          {(['economy', 'balanced', 'quality'] as const).map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-2 text-[12px] text-muted">
              <input
                type="radio"
                name="costMode"
                className="mt-0.5"
                checked={(settings.costMode ?? 'balanced') === mode}
                onChange={() => updateSetting('costMode', mode)}
              />
              <span>{COST_MODE_LABEL[mode]}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/20 pt-4">
          <div className="text-[13px] font-semibold">Monthly budget</div>
          <div className="text-[11.5px] text-muted">
            Once this month's estimated spend reaches the budget, paid providers stop being used — the app falls back to
            local/free processing instead of silently continuing to spend. $0 means unlimited.
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {BUDGET_PRESETS_USD.map((amount) => (
              <button
                key={amount}
                onClick={() => updateSetting('monthlyBudgetUsd', amount)}
                className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                  (settings.monthlyBudgetUsd ?? 0) === amount ? 'bg-accent text-accent-ink' : 'bg-surface-tint text-muted hover:text-foreground'
                }`}
              >
                {amount === 0 ? 'Unlimited' : `$${amount}`}
              </button>
            ))}
            <input
              type="number"
              min={0}
              placeholder="Custom $"
              value={customBudget}
              onChange={(e) => setCustomBudget(e.target.value)}
              onBlur={() => {
                const parsed = Number(customBudget);
                if (customBudget !== '' && !Number.isNaN(parsed) && parsed >= 0) updateSetting('monthlyBudgetUsd', parsed);
              }}
              className="w-24 rounded-md border border-border/30 bg-surface px-2 py-1 text-[11.5px] text-foreground"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/20 pt-4">
          <div>
            <div className="text-[13px] font-semibold">Local-Only Mode</div>
            <div className="text-[11.5px] text-muted">
              Never send meeting content to any cloud provider, regardless of cost mode or budget. If local processing
              can't complete, you'll see an error instead of it silently falling back to the cloud.
            </div>
          </div>
          <Toggle checked={settings.localOnlyMode ?? false} onChange={(v) => updateSetting('localOnlyMode', v)} />
        </div>

        <div className="flex items-center justify-between border-t border-border/20 pt-4">
          <div>
            <div className="text-[13px] font-semibold">Enable caching</div>
            <div className="text-[11.5px] text-muted">Repeated identical translation/response requests are served from a short-lived cache instead of calling a provider again.</div>
          </div>
          <Toggle checked={settings.enableCaching ?? true} onChange={(v) => updateSetting('enableCaching', v)} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-muted">Clear the cache now.</span>
          <Button variant="ghost" onClick={handleClearCache}>
            Clear cache
          </Button>
        </div>
        {cacheCleared && <p className="text-[11.5px] text-success">Cache cleared.</p>}
      </Card>

      <Card className="flex flex-col gap-4">
        <h4 className="text-[13px] font-bold">Audio Output</h4>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">Output device</div>
            <div className="text-[11.5px] text-muted">Where "Speak" plays audio. Stays on your system default unless you pick another device here.</div>
          </div>
          <select
            className="rounded-md border border-border/30 bg-surface px-2 py-1.5 text-[12.5px] text-foreground"
            value={selectedOutputDevice}
            onChange={(e) => handleOutputDeviceChange(e.target.value)}
          >
            <option value="default">System Default</option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-border/20 bg-surface-tint/40 p-3">
          <div className="text-[13px] font-semibold">Routing voice responses into Zoom/Meet (optional)</div>
          <p className="mt-1 text-[11.5px] text-muted">
            KVL never routes its audio into a meeting app automatically. If you want participants to hear a spoken
            response, install a virtual audio cable yourself, then select it above as the output device:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11.5px] text-muted">
            <li><span className="font-semibold text-foreground">Windows:</span> install VB-Audio Virtual Cable, then set your meeting app's microphone to "CABLE Output".</li>
            <li><span className="font-semibold text-foreground">macOS:</span> install BlackHole (2ch), then set your meeting app's microphone to "BlackHole 2ch".</li>
            <li><span className="font-semibold text-foreground">Linux:</span> create a PulseAudio/PipeWire null-sink (<code>pactl load-module module-null-sink sink_name=kvl</code>), then select it as your meeting app's microphone.</li>
          </ul>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h4 className="text-[13px] font-bold">About & Updates</h4>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Version</div>
            <div className="text-[11.5px] text-muted">{appVersion ?? 'Loading…'}</div>
          </div>
          <Button variant="secondary" onClick={handleCheckForUpdate} disabled={checkingUpdate || isMeetingActive}>
            {checkingUpdate ? 'Checking…' : 'Check for Updates'}
          </Button>
        </div>
        {isMeetingActive && <p className="text-[11.5px] text-muted">Update checks are disabled during an active meeting.</p>}
        {updateResult && (
          <div className="flex items-center gap-2 text-[11.5px]">
            {updateResult.status === 'up-to-date' && <Badge variant="success">Up to date</Badge>}
            {updateResult.status === 'update-available' && <Badge variant="warning">Update available: {updateResult.latestVersion}</Badge>}
            {updateResult.status === 'error' && <Badge variant="danger">Could not check for updates</Badge>}
            {updateResult.message && <span className="text-muted">{updateResult.message}</span>}
          </div>
        )}
      </Card>

      <Card className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold">Setup Wizard</div>
          <div className="text-[11.5px] text-muted">Re-run the first-run audio/language/provider/privacy walkthrough.</div>
        </div>
        <Button variant="secondary" onClick={handleRedoSetupWizard}>
          Redo Setup Wizard
        </Button>
      </Card>
    </div>
  );
}
