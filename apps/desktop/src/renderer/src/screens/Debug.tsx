import { useEffect, useState } from 'react';
import type { ProviderHealthEntryDTO } from '@kvl/shared';
import { Badge, Button, Card } from '@kvl/ui';
import { onProvidersHealthData, onCopilotQueueData, send } from '../services/wsClient';
import { useConnectionStore } from '../state/connectionStore';
import { useUsageStore } from '../state/usageStore';
import { useNetworkStore } from '../state/networkStore';
import { useMeetingStore } from '../state/meetingStore';
import { useTranslationStatusStore } from '../state/translationStatusStore';
import { useResponseStatusStore } from '../state/responseStatusStore';
import { useTtsStore } from '../state/ttsStore';
import { useExplainStore } from '../state/explainStore';
import { useSummaryStore } from '../state/summaryStore';

interface ResourceUsage {
  rssBytes: number;
  heapUsedBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
}

const STATUS_VARIANT: Record<ProviderHealthEntryDTO['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  'rate-limited': 'warning',
  unavailable: 'danger',
  disabled: 'neutral',
};

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLatency(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`;
}

/**
 * Admin/Debug screen (Phase 11) — provider health/circuit-breaker status
 * cross-referenced from ProviderHealthRegistry + api_providers (backend),
 * plus this process's own resource usage (already exposed since Phase 2's
 * diagnostics work, reused here rather than duplicated). Deliberately never
 * shows a raw or decrypted API key — only status/label/kind, matching this
 * repo's "never expose secrets" rule everywhere else.
 */
export function Debug() {
  const [providers, setProviders] = useState<ProviderHealthEntryDTO[]>([]);
  const [resourceUsage, setResourceUsage] = useState<ResourceUsage | null>(null);
  const [copilotQueueCount, setCopilotQueueCount] = useState<number | null>(null);
  const connectionStatus = useConnectionStore((s) => s.status);
  const isOnline = useNetworkStore((s) => s.isOnline);
  const usage = useUsageStore((s) => s.usage);
  const activeSessionId = useMeetingStore((s) => s.sessionId);
  const translationLatencyMs = useTranslationStatusStore((s) => s.lastLatencyMs);
  const responseLatencyMs = useResponseStatusStore((s) => s.lastLatencyMs);
  const ttsLatencyMs = useTtsStore((s) => s.lastLatencyMs);
  const explainLatencyMs = useExplainStore((s) => s.lastLatencyMs);
  const summaryLatencyMs = useSummaryStore((s) => s.lastLatencyMs);

  useEffect(() => {
    const unsubscribeHealth = onProvidersHealthData((message) => setProviders(message.providers));
    const unsubscribeQueue = onCopilotQueueData((message) => setCopilotQueueCount(message.count));
    send({ type: 'providers:health' });
    window.kvlAPI.getResourceUsage().then(setResourceUsage);
    if (activeSessionId) send({ type: 'copilot:queue-status', sessionId: activeSessionId });
    const interval = setInterval(() => {
      send({ type: 'providers:health' });
      window.kvlAPI.getResourceUsage().then(setResourceUsage);
      if (activeSessionId) send({ type: 'copilot:queue-status', sessionId: activeSessionId });
    }, 5000);
    return () => {
      unsubscribeHealth();
      unsubscribeQueue();
      clearInterval(interval);
    };
  }, [activeSessionId]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Debug</h1>
          <p className="mt-1 text-[13px] text-muted">Provider health, circuit breakers, and process resource usage. Never shows API keys.</p>
        </div>
        <Button variant="ghost" onClick={() => send({ type: 'providers:health' })}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
        <Card className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Backend</span>
          <Badge variant={connectionStatus === 'connected' ? 'success' : 'danger'}>{connectionStatus}</Badge>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Network</span>
          <Badge variant={isOnline ? 'success' : 'danger'}>{isOnline ? 'online' : 'offline'}</Badge>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Memory (RSS)</span>
          <span className="text-[15px] font-bold">{resourceUsage ? formatBytes(resourceUsage.rssBytes) : '—'}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Heap used</span>
          <span className="text-[15px] font-bold">{resourceUsage ? formatBytes(resourceUsage.heapUsedBytes) : '—'}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Copilot queue</span>
          <span className="text-[15px] font-bold">{activeSessionId ? (copilotQueueCount ?? '—') : '—'}</span>
        </Card>
      </div>

      <Card className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Pipeline latency</h4>
        <p className="text-[11.5px] text-muted">Renderer-observed wall-clock time between a request being sent and its result arriving over WS. Resets to — after a fresh app launch until each pipeline is used at least once.</p>
        {[
          { label: 'Translation', ms: translationLatencyMs },
          { label: 'My Response (generate)', ms: responseLatencyMs },
          { label: 'Text-to-Speech', ms: ttsLatencyMs },
          { label: 'Explain ("What does this mean?")', ms: explainLatencyMs },
          { label: 'Meeting Summary (generate)', ms: summaryLatencyMs },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between border-b border-border/10 py-2 text-[12.5px] last:border-b-0">
            <span className="font-semibold text-foreground">{row.label}</span>
            <span className="text-muted">{formatLatency(row.ms)}</span>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Provider health</h4>
        {providers.length === 0 ? (
          <p className="text-[12px] text-muted">No active cloud providers configured.</p>
        ) : (
          providers.map((p) => (
            <div key={p.providerId} className="flex items-center justify-between border-b border-border/10 py-2 text-[12.5px] last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{p.label}</span>
                <span className="text-muted">({p.kind})</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted">
                  {p.requestsInLastMinute} req/min · {p.consecutiveErrors} consecutive errors
                </span>
                <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className="flex flex-col gap-1 text-[12.5px] text-muted">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Cost mode summary</h4>
        {usage ? (
          <>
            <span>Month-to-date: ${usage.monthCostUsd.toFixed(2)} {usage.monthlyBudgetUsd > 0 ? `of $${usage.monthlyBudgetUsd.toFixed(2)} budget` : '(unlimited)'}</span>
            <span>{usage.localSharePercent}% of requests served locally/free this month.</span>
          </>
        ) : (
          <span>Loading…</span>
        )}
      </Card>
    </div>
  );
}
