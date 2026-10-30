import { useEffect } from 'react';
import { Badge, Card } from '@kvl/ui';
import { useUsageStore } from '../state/usageStore';
import { send } from '../services/wsClient';

function money(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function UsageDashboard() {
  const usage = useUsageStore((s) => s.usage);

  useEffect(() => {
    send({ type: 'usage:get' });
  }, []);

  if (!usage) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">API Usage</h1>
        <Card>
          <p className="text-[12.5px] text-muted">Loading usage data…</p>
        </Card>
      </div>
    );
  }

  const budgetVariant = usage.budgetExceeded ? 'danger' : usage.budgetPercentUsed >= 80 ? 'warning' : 'success';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">API Usage</h1>
        <p className="mt-1 text-[13px] text-muted">Estimated cost from provider rate tables, not exact billing. Local/free tiers always cost $0.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Today</span>
          <span className="text-2xl font-extrabold">{money(usage.todayCostUsd)}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">This week</span>
          <span className="text-2xl font-extrabold">{money(usage.weekCostUsd)}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">This month</span>
          <span className="text-2xl font-extrabold">{money(usage.monthCostUsd)}</span>
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Monthly budget</h4>
          <Badge variant={budgetVariant}>
            {usage.monthlyBudgetUsd > 0 ? `${usage.budgetPercentUsed}% of ${money(usage.monthlyBudgetUsd)}` : 'Unlimited'}
          </Badge>
        </div>
        {usage.monthlyBudgetUsd > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-border/20">
            <div
              className={`h-full rounded-full transition-[width] ${usage.budgetExceeded ? 'bg-danger' : usage.budgetPercentUsed >= 80 ? 'bg-warning' : 'bg-accent'}`}
              style={{ width: `${Math.min(100, usage.budgetPercentUsed)}%` }}
            />
          </div>
        )}
        {usage.budgetExceeded && (
          <p className="text-[11.5px] text-danger">Budget reached — paid providers are being skipped this month; local/free processing continues.</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">Local vs cloud (this month)</h4>
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/20">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${usage.localSharePercent}%` }} />
          </div>
          <span className="text-[12px] text-muted">{usage.localSharePercent}% local</span>
        </div>
        <p className="text-[11.5px] text-muted">
          {usage.monthRequestCount} total requests this month · {usage.localRequestCount} local/free · {usage.cloudRequestCount} paid
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">By pipeline</h4>
          {usage.byKind.length === 0 ? (
            <p className="text-[12px] text-muted">No usage yet.</p>
          ) : (
            usage.byKind.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between text-[12.5px]">
                <span className="capitalize text-foreground">{entry.key}</span>
                <span className="text-muted">
                  {entry.requestCount} req · {money(entry.totalCostUsd)}
                </span>
              </div>
            ))
          )}
        </Card>
        <Card className="flex flex-col gap-2">
          <h4 className="text-[13px] font-bold uppercase tracking-wide text-muted">By provider</h4>
          {usage.byProvider.length === 0 ? (
            <p className="text-[12px] text-muted">No usage yet.</p>
          ) : (
            usage.byProvider.map((entry) => (
              <div key={entry.key} className="flex items-center justify-between text-[12.5px]">
                <span className="text-foreground">{entry.key}</span>
                <span className="text-muted">
                  {entry.requestCount} req · {money(entry.totalCostUsd)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
