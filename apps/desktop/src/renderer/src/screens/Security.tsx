import { useEffect, useState } from 'react';
import type { ProviderConfigPublic, ProviderKind } from '@kvl/shared';
import { Badge, Button, Card, useToast } from '@kvl/ui';
import { onHistoryData, onProvidersData, onSettingsData, send } from '../services/wsClient';

interface AppSettings {
  localOnlyMode?: boolean;
  transcriptRetentionPolicy?: string;
  saveTranscript?: boolean;
  saveSummary?: boolean;
  enableCaching?: boolean;
}

interface ProviderDataFlowRow {
  kind: ProviderKind;
  service: string;
  dataSent: string;
  purpose: string;
  tiers: string;
}

/** Written to be literally accurate to what this codebase's code does
 * (verified during this project's own Phase 3-11 build work) — "do not
 * claim privacy guarantees that cannot be verified." */
const PROVIDER_DATA_FLOW: ProviderDataFlowRow[] = [
  { kind: 'stt', service: 'Speech-to-Text', dataSent: 'Short audio chunks (a few seconds each) from the meeting', purpose: 'Transcribe English speech to text', tiers: 'Local (Whisper, offline) → Cloud' },
  { kind: 'translation', service: 'Translation', dataSent: 'Transcript text segments', purpose: 'Translate English → Hindi/Hinglish', tiers: 'Local (phrasebook) → Free (Argos/LibreTranslate) → Cloud' },
  { kind: 'response', service: 'My Response', dataSent: 'The Hindi/Hinglish text you speak or type', purpose: 'Draft a professional English reply', tiers: 'Local (phrasebook) → Free → Cloud' },
  { kind: 'tts', service: 'Text-to-Speech', dataSent: 'The English reply text you choose to speak', purpose: 'Synthesize spoken audio for playback', tiers: 'Local (espeak-ng) → Browser → Cloud' },
  { kind: 'explanation', service: '"What does this mean?"', dataSent: 'The selected sentence plus a small surrounding context window', purpose: 'Explain a difficult sentence in simple terms', tiers: 'Local (partial) → Cloud' },
  { kind: 'copilot', service: 'Meeting Copilot', dataSent: 'Batched transcript segments (only when a real cloud key is configured and cost mode/budget allow it)', purpose: 'Detect decisions/action items/deadlines/etc.', tiers: 'Local pattern-detection (always) + batched Cloud (optional)' },
  { kind: 'summary', service: 'Meeting Summary', dataSent: 'Up to the most recent 12,000 characters of the transcript', purpose: 'Synthesize an executive summary and key points', tiers: 'Cloud only (7 of 11 summary sections are confirmed facts from your own copilot data — zero AI, no data sent)' },
];

const KIND_LABEL: Record<ProviderKind, string> = {
  stt: 'Speech-to-Text',
  translation: 'Translation',
  response: 'My Response',
  tts: 'Text-to-Speech',
  explanation: 'Explanation',
  copilot: 'Meeting Copilot',
  summary: 'Meeting Summary',
};

function FactRow({ label, detail, ok }: { label: string; detail: string; ok: boolean | 'info' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/10 py-2 last:border-b-0">
      <div>
        <div className="text-[12.5px] font-semibold text-foreground">{label}</div>
        <div className="text-[11.5px] text-muted">{detail}</div>
      </div>
      <Badge variant={ok === 'info' ? 'neutral' : ok ? 'success' : 'warning'}>{ok === 'info' ? 'Info' : ok ? 'OK' : 'Review'}</Badge>
    </div>
  );
}

export function Security() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([]);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lastAuditAt, setLastAuditAt] = useState<string | null>(null);
  const { push } = useToast();

  function runAudit() {
    send({ type: 'settings:get' });
    send({ type: 'providers:list' });
    window.kvlAPI.isEncryptionAvailable().then(setEncryptionAvailable);
    setLastAuditAt(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    const unsubSettings = onSettingsData((message) => setSettings(message.settings as AppSettings));
    const unsubProviders = onProvidersData((message) => setProviders(message.providers));
    const unsubHistory = onHistoryData(() => {
      push('success', 'All meeting data deleted.');
      setDeleteConfirm(false);
    });
    runAudit();
    return () => {
      unsubSettings();
      unsubProviders();
      unsubHistory();
    };
  }, []);

  function handleDeleteAll() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    send({ type: 'history:clear' }); // deletes every meeting_sessions row, cascading every per-session table
  }

  const configuredKinds = new Set(providers.filter((p) => p.hasApiKey && p.isActive).map((p) => p.kind));

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Security</h1>
          <p className="mt-1 text-[13px] text-muted">
            An honest status view of how this app is built — not a simulated deep scan, just real current state.
          </p>
        </div>
        <Button variant="secondary" onClick={runAudit}>
          Run Security Audit
        </Button>
      </div>
      {lastAuditAt && <p className="text-[11px] text-muted">Last checked: {lastAuditAt}</p>}

      <Card className="flex flex-col">
        <h4 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Electron &amp; process security</h4>
        <FactRow label="Context isolation" detail="Enabled on every window — the renderer never gets direct Node.js/Electron API access, only the explicit kvlAPI bridge." ok={true} />
        <FactRow label="Renderer sandbox" detail="Disabled on the main/mini windows (enabled on the throwaway PDF-export window). A known, deliberately-deferred hardening item — flipping it needs a preload-compatibility review to avoid breaking working features." ok={false} />
        <FactRow label="External links" detail="Popup windows are denied and routed to your OS default browser instead of opening inside the app." ok={true} />
        <FactRow label="Content Security Policy" detail="default-src 'self' — scripts/styles/connections restricted to the app's own bundle plus the local backend WebSocket." ok={true} />
      </Card>

      <Card className="flex flex-col">
        <h4 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">API key protection</h4>
        <FactRow label="OS secure storage" detail={encryptionAvailable ? 'Available — provider keys are encrypted with your OS keyring before ever being stored.' : 'Unavailable on this system — saving new provider keys is disabled until a keyring is available.'} ok={encryptionAvailable} />
        <FactRow label="At-rest storage" detail="Only ciphertext is ever written to the local database — no plaintext API key column exists anywhere in the schema." ok={true} />
        <FactRow label="Decrypt boundary" detail="Only Electron's main process can decrypt a key, only for as long as a single provider connection needs it — never logged, never sent anywhere but the provider's own API." ok={true} />
      </Card>

      <Card className="flex flex-col">
        <h4 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">WebSocket security</h4>
        <FactRow label="Network exposure" detail="The backend only binds to 127.0.0.1 — never reachable from other machines on your network." ok={true} />
        <FactRow label="Connection authentication" detail="A fresh per-launch token is required to connect — an arbitrary local process or webpage can no longer open a connection and read live meeting content." ok={true} />
        <FactRow label="Rate &amp; size limits" detail="Messages are capped at 5MB and rate-limited per connection; at most 10 simultaneous connections are allowed." ok={true} />
      </Card>

      <Card className="flex flex-col">
        <h4 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Database &amp; export security</h4>
        <FactRow label="SQL injection" detail="Every query in this app uses parameterized placeholders — no raw string interpolation of your data into SQL, anywhere." ok={true} />
        <FactRow label="Migration safety" detail="Schema migrations run atomically — a failure partway through can no longer leave the database in a corrupted, unrecoverable state." ok={true} />
        <FactRow label="File exports" detail="TXT/Markdown/PDF/JSON exports always go through your OS's native save dialog — a compromised renderer could never write to an arbitrary path." ok={true} />
        <FactRow label="PDF content" detail="Transcript/summary text is HTML-escaped before it's rendered into an exported PDF — no injection path into the exported file." ok={true} />
      </Card>

      <Card className="flex flex-col gap-3">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Your current privacy settings</h4>
        <FactRow label="Local-Only Mode" detail={settings.localOnlyMode ? 'On — no meeting content can reach any cloud provider.' : 'Off — cloud providers are used per your cost mode/budget settings.'} ok="info" />
        <FactRow label="Save transcript" detail={(settings.saveTranscript ?? true) ? `On, retention: ${settings.transcriptRetentionPolicy ?? 'never (kept until you delete a meeting)'}` : 'Off — transcripts only exist in memory during a live session.'} ok="info" />
        <FactRow label="Save summary" detail={(settings.saveSummary ?? true) ? 'On — "Save locally" on a generated summary actually persists it.' : 'Off — generated summaries are never saved.'} ok="info" />
        <FactRow label="Caching" detail={(settings.enableCaching ?? true) ? 'On — repeated identical requests are served from a short-lived local cache.' : 'Off — every request always reaches a real provider.'} ok="info" />
      </Card>

      <Card className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">What data goes where</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="border-b border-border/20 text-left text-muted">
                <th className="py-1.5 pr-3">Service</th>
                <th className="py-1.5 pr-3">Data sent (if cloud tier used)</th>
                <th className="py-1.5 pr-3">Purpose</th>
                <th className="py-1.5">Configured?</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_DATA_FLOW.map((row) => (
                <tr key={row.kind} className="border-b border-border/10 last:border-b-0">
                  <td className="py-1.5 pr-3 align-top font-semibold text-foreground">
                    {row.service}
                    <div className="font-normal text-muted">{row.tiers}</div>
                  </td>
                  <td className="py-1.5 pr-3 align-top text-muted">{row.dataSent}</td>
                  <td className="py-1.5 pr-3 align-top text-muted">{row.purpose}</td>
                  <td className="py-1.5 align-top">
                    <Badge variant={configuredKinds.has(row.kind) ? 'success' : 'neutral'}>{configuredKinds.has(row.kind) ? 'Cloud configured' : 'Local/Free only'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex items-center justify-between border-danger/30">
        <div>
          <div className="text-[13px] font-semibold">Delete All Data</div>
          <div className="text-[11.5px] text-muted">Permanently removes every meeting — transcripts, translations, AI analysis, action items, summaries. Not your API keys or settings.</div>
        </div>
        <Button variant="danger" onClick={handleDeleteAll}>
          {deleteConfirm ? 'Confirm delete' : 'Delete'}
        </Button>
      </Card>
    </div>
  );
}
