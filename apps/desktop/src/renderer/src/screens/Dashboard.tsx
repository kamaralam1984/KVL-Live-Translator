import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProviderConfigPublic } from '@kvl/shared';
import { Badge, Button, Card, ProgressRing } from '@kvl/ui';
import { useConnectionStore } from '../state/connectionStore';
import { useMeetingHistoryStore } from '../state/meetingHistoryStore';
import { onProvidersData, send } from '../services/wsClient';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function Dashboard() {
  const connectionStatus = useConnectionStore((s) => s.status);
  const meetings = useMeetingHistoryStore((s) => s.meetings);
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([]);

  useEffect(() => {
    const unsubscribe = onProvidersData((message) => setProviders(message.providers));
    send({ type: 'providers:list' });
    send({ type: 'meetings:list' });
    return unsubscribe;
  }, []);

  const configuredProviderCount = useMemo(() => providers.filter((p) => p.hasApiKey && p.isActive).length, [providers]);
  const sessionsThisWeek = useMemo(() => {
    const cutoff = Date.now() - ONE_WEEK_MS;
    return meetings.filter((m) => new Date(m.startedAt).getTime() >= cutoff).length;
  }, [meetings]);

  const setupSteps = useMemo(
    () => [
      { label: 'Connected to backend', done: connectionStatus === 'connected' },
      { label: 'At least one cloud provider configured', done: configuredProviderCount > 0 },
    ],
    [connectionStatus, configuredProviderCount],
  );
  const setupPercent = Math.round((setupSteps.filter((s) => s.done).length / setupSteps.length) * 100);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="mt-1 text-[13px] text-muted">Overview of your KVL Live Translator setup.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Backend</span>
          <Badge variant={connectionStatus === 'connected' ? 'success' : connectionStatus === 'connecting' ? 'warning' : 'danger'}>
            {connectionStatus}
          </Badge>
        </Card>
        <Card className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Providers configured</span>
          <span className="text-2xl font-extrabold">{configuredProviderCount}</span>
        </Card>
        <Card className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Sessions this week</span>
          <span className="text-2xl font-extrabold">{sessionsThisWeek}</span>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
        <Card className="flex flex-col items-start gap-3">
          <h4 className="text-[13.5px] font-bold">Ready to start a meeting?</h4>
          <p className="text-[12px] text-muted">
            Open the Meeting Translator workspace to begin a session. Local speech/translation/TTS providers work with
            no setup — add a cloud provider under API Providers for higher-quality results.
          </p>
          <Link to="/translator">
            <Button variant="gold">Open Meeting Translator →</Button>
          </Link>
        </Card>

        <Card className="flex flex-col items-center justify-center gap-3">
          <ProgressRing percent={setupPercent} label="Setup" size={96} />
          <ul className="flex flex-col gap-1 text-[11px] text-muted">
            {setupSteps.map((step) => (
              <li key={step.label} className="flex items-center gap-1.5">
                <span className={step.done ? 'text-success' : 'text-muted'}>{step.done ? '✓' : '○'}</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
