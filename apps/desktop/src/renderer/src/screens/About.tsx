import { useEffect, useState } from 'react';
import { Badge, Button, Card } from '@kvl/ui';
import { useConnectionStore } from '../state/connectionStore';
import type { AppVersions, ResourceUsage } from '../../../preload/index';

const BUILT_FEATURES = [
  'Live meeting capture & English speech-to-text',
  'Real-time Hindi/Hinglish translation',
  'My Response — speak/type Hindi, get a reviewable English draft',
  'Text-to-speech playback for your response (Local → Browser → Cloud)',
  '"What does this mean?" per-sentence explanations',
  'Smart Meeting Copilot — auto-detected questions, decisions, action items, deadlines & more',
  'AI Meeting Summary with confirmed-facts vs AI-interpretation split, export & Meeting History',
  'Multi-provider cost orchestration — economy/balanced/quality modes, budgets, Local-Only Mode',
  'Floating meeting window — full/compact/mini/collapsed, always-on-top, global shortcuts',
  'Privacy & security hardening — authenticated WebSocket, encrypted keys, a live Security screen',
  'Production stability — bounded memory, crash recovery, audio auto-retry, a performance dashboard',
  'First-run setup wizard and a packaged installer build',
];

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Phase 15 diagnostics: never includes API keys, raw audio, transcript
 * content, or passwords — only version/platform/connection/resource info,
 * matching this app's standing "never expose secrets" rule everywhere else.
 */
export function About() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>('unknown');
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [resourceUsage, setResourceUsage] = useState<ResourceUsage | null>(null);
  const connectionStatus = useConnectionStore((s) => s.status);

  useEffect(() => {
    window.kvlAPI.getAppVersion().then(setAppVersion);
    window.kvlAPI.getPlatform().then(setPlatform);
    window.kvlAPI.getAppVersions().then(setVersions);
    window.kvlAPI.getResourceUsage().then(setResourceUsage);
  }, []);

  function buildDiagnosticReport(): string {
    const lines = [
      'KVL Live Translator — Diagnostic Report',
      `App version: ${appVersion ?? 'unknown'}`,
      `Platform: ${platform}`,
      `Electron: ${versions?.electron ?? 'unknown'}`,
      `Chromium: ${versions?.chrome ?? 'unknown'}`,
      `Node: ${versions?.node ?? 'unknown'}`,
      `Backend connection: ${connectionStatus}`,
      `Memory (RSS): ${resourceUsage ? formatBytes(resourceUsage.rssBytes) : 'unknown'}`,
      `Heap used: ${resourceUsage ? formatBytes(resourceUsage.heapUsedBytes) : 'unknown'}`,
      '',
      'This report never includes API keys, raw audio, transcript content, or passwords.',
    ];
    return lines.join('\n');
  }

  async function handleExportReport() {
    const report = buildDiagnosticReport();
    await window.kvlAPI.saveTextFile(report, 'kvl-diagnostic-report.txt', [{ name: 'Text', extensions: ['txt'] }]);
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">KVL Live Translator</h1>
        <p className="mt-1 text-[13px] text-muted">Real-time meeting language assistant — English ↔ Hindi/Hinglish.</p>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Version</span>
          <Badge variant="gold">{appVersion ?? 'Loading…'} · All 15 phases complete</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Build</span>
          <span className="text-[12.5px] text-muted">Live translation, response drafting, TTS, copilot, meeting summaries, cost orchestration, and production stability — built and tested phase by phase</span>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[13.5px] font-bold">Diagnostics</h4>
          <Button variant="ghost" onClick={handleExportReport}>
            Export Diagnostic Report
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted">
          <span>Platform</span>
          <span className="text-foreground">{platform}</span>
          <span>Electron</span>
          <span className="text-foreground">{versions?.electron ?? '—'}</span>
          <span>Chromium</span>
          <span className="text-foreground">{versions?.chrome ?? '—'}</span>
          <span>Node</span>
          <span className="text-foreground">{versions?.node ?? '—'}</span>
          <span>Backend connection</span>
          <span className="text-foreground">{connectionStatus}</span>
          <span>Memory (RSS)</span>
          <span className="text-foreground">{resourceUsage ? formatBytes(resourceUsage.rssBytes) : '—'}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted">Never includes API keys, raw audio, transcript content, or passwords.</p>
      </Card>

      <Card>
        <h4 className="mb-1 text-[13.5px] font-bold">What this does</h4>
        <p className="text-[12px] leading-relaxed text-muted">
          KVL Live Translator listens to your meeting audio, transcribes English speech, translates it into
          Hindi/Hinglish, and drafts English replies you can send back — all running locally on your machine.
        </p>
      </Card>

      <Card>
        <h4 className="mb-2 text-[13.5px] font-bold">Built so far</h4>
        <ul className="flex flex-col gap-1.5 text-[12px] text-muted">
          {BUILT_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span className="mt-0.5 text-accent">✓</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
