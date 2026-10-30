import type { ProviderKind, UsageBreakdownEntry, UsageSummaryDTO, SessionCostDTO } from '@kvl/shared';
import { usageRecordsRepository } from '../db/repositories/usageRecordsRepository';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { backendEventBus } from '../events/backendEventBus';
import { childLogger } from '../logger';

const log = childLogger('cost');

/** Static, documented $/unit estimate table — not real per-token billing
 * (none of the 7 Cloud providers currently parse a `usage` field out of
 * their responses; adding that would mean touching all 7 provider files,
 * which this phase deliberately avoids). "Estimated" is the honest word for
 * what this produces; tune the numbers here if real bills differ. */
const RATE_TABLE: Record<ProviderKind, { unit: 'char' | 'audio-second'; usdPerUnit: number }> = {
  stt: { unit: 'audio-second', usdPerUnit: 0.0001 }, // ~ $0.006/minute, Whisper-style
  translation: { unit: 'char', usdPerUnit: 0.000002 }, // ~ $0.002 / 1,000 chars, small chat-completions call
  response: { unit: 'char', usdPerUnit: 0.000002 },
  tts: { unit: 'char', usdPerUnit: 0.000015 }, // ~ $15 / 1M input chars
  explanation: { unit: 'char', usdPerUnit: 0.000003 },
  copilot: { unit: 'char', usdPerUnit: 0.000003 },
  summary: { unit: 'char', usdPerUnit: 0.000003 },
};

const BUDGET_THRESHOLDS = [80, 90, 100] as const;

export function estimateCostUsd(
  kind: ProviderKind,
  requiresApiKey: boolean,
  input: { inputUnits?: number; outputUnits?: number; audioSeconds?: number },
): number {
  if (!requiresApiKey) return 0; // local/free tiers never cost money
  const rate = RATE_TABLE[kind];
  if (rate.unit === 'audio-second') return (input.audioSeconds ?? 0) * rate.usdPerUnit;
  return ((input.inputUnits ?? 0) + (input.outputUnits ?? 0)) * rate.usdPerUnit;
}

export function startOfDayIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function startOfWeekIso(now: Date): string {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function startOfMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Given the current month spend/budget and what threshold was last
 * notified this month, returns the highest newly-crossed threshold (or null
 * if none) — pure so it's directly node-testable without touching settings. */
export function nextThresholdToNotify(monthCostUsd: number, monthlyBudgetUsd: number, lastNotifiedPercent: number): (typeof BUDGET_THRESHOLDS)[number] | null {
  if (monthlyBudgetUsd <= 0) return null; // 0 = unlimited, no thresholds apply
  const percentUsed = (monthCostUsd / monthlyBudgetUsd) * 100;
  let crossed: (typeof BUDGET_THRESHOLDS)[number] | null = null;
  for (const threshold of BUDGET_THRESHOLDS) {
    if (percentUsed >= threshold && threshold > lastNotifiedPercent) crossed = threshold;
  }
  return crossed;
}

function summarize(rows: { estimated_cost_usd: number; provider_kind: string; provider_id: string | null; provider_label: string; tier: string }[]): UsageBreakdownEntry[] {
  const byKey = new Map<string, { requestCount: number; totalCostUsd: number }>();
  for (const row of rows) {
    const entry = byKey.get(row.provider_kind) ?? { requestCount: 0, totalCostUsd: 0 };
    entry.requestCount += 1;
    entry.totalCostUsd += row.estimated_cost_usd;
    byKey.set(row.provider_kind, entry);
  }
  return Array.from(byKey.entries()).map(([key, v]) => ({ key, ...v }));
}

function summarizeByProvider(rows: { estimated_cost_usd: number; provider_label: string }[]): UsageBreakdownEntry[] {
  const byKey = new Map<string, { requestCount: number; totalCostUsd: number }>();
  for (const row of rows) {
    const entry = byKey.get(row.provider_label) ?? { requestCount: 0, totalCostUsd: 0 };
    entry.requestCount += 1;
    entry.totalCostUsd += row.estimated_cost_usd;
    byKey.set(row.provider_label, entry);
  }
  return Array.from(byKey.entries()).map(([key, v]) => ({ key, ...v }));
}

class CostManager {
  private monthlyBudgetUsd = 0;

  refreshSettings(): void {
    const settings = settingsRepository.getAll();
    this.monthlyBudgetUsd = typeof settings.monthlyBudgetUsd === 'number' ? settings.monthlyBudgetUsd : 0;
  }

  record(entry: {
    kind: ProviderKind;
    providerId: string | null;
    providerLabel: string;
    tier: string;
    requiresApiKey: boolean;
    requestType: string;
    inputUnits?: number;
    outputUnits?: number;
    audioSeconds?: number;
    meetingSessionId?: string | null;
  }): void {
    const now = new Date();
    const cost = estimateCostUsd(entry.kind, entry.requiresApiKey, entry);
    usageRecordsRepository.insert({
      providerKind: entry.kind,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      tier: entry.tier,
      requestType: entry.requestType,
      inputUnits: entry.inputUnits ?? 0,
      outputUnits: entry.outputUnits ?? 0,
      audioSeconds: entry.audioSeconds ?? null,
      estimatedCostUsd: cost,
      meetingSessionId: entry.meetingSessionId ?? null,
      createdAt: now.toISOString(),
    });

    if (cost > 0 && this.monthlyBudgetUsd > 0) this.maybeNotifyThreshold(now);
  }

  private maybeNotifyThreshold(now: Date): void {
    const settings = settingsRepository.getAll();
    const key = monthKey(now);
    const storedMonth = settings.costBudgetLastNotifiedMonth;
    const lastNotifiedPercent = storedMonth === key && typeof settings.costBudgetLastNotifiedPercent === 'number' ? settings.costBudgetLastNotifiedPercent : 0;

    const monthCostUsd = usageRecordsRepository.sumCostSince(startOfMonthIso(now));
    const crossed = nextThresholdToNotify(monthCostUsd, this.monthlyBudgetUsd, lastNotifiedPercent);
    if (crossed === null) return;

    settingsRepository.update({ costBudgetLastNotifiedMonth: key, costBudgetLastNotifiedPercent: crossed });
    log.warn({ crossed, monthCostUsd, monthlyBudgetUsd: this.monthlyBudgetUsd }, 'monthly budget threshold crossed');
    backendEventBus.emit('usage:budget-threshold-crossed', { percent: crossed, monthCostUsd, monthlyBudgetUsd: this.monthlyBudgetUsd });
  }

  isBudgetExceeded(): boolean {
    if (this.monthlyBudgetUsd <= 0) return false; // 0 = unlimited
    const monthCostUsd = usageRecordsRepository.sumCostSince(startOfMonthIso(new Date()));
    return monthCostUsd >= this.monthlyBudgetUsd;
  }

  getSummary(): UsageSummaryDTO {
    const now = new Date();
    const todayCostUsd = usageRecordsRepository.sumCostSince(startOfDayIso(now));
    const weekCostUsd = usageRecordsRepository.sumCostSince(startOfWeekIso(now));
    const monthRows = usageRecordsRepository.listSince(startOfMonthIso(now));
    const monthCostUsd = monthRows.reduce((sum, r) => sum + r.estimated_cost_usd, 0);
    const localRequestCount = monthRows.filter((r) => r.estimated_cost_usd === 0).length;
    const cloudRequestCount = monthRows.length - localRequestCount;

    return {
      todayCostUsd,
      weekCostUsd,
      monthCostUsd,
      monthRequestCount: monthRows.length,
      localRequestCount,
      cloudRequestCount,
      localSharePercent: monthRows.length === 0 ? 100 : Math.round((localRequestCount / monthRows.length) * 100),
      monthlyBudgetUsd: this.monthlyBudgetUsd,
      budgetPercentUsed: this.monthlyBudgetUsd > 0 ? Math.round((monthCostUsd / this.monthlyBudgetUsd) * 100) : 0,
      budgetExceeded: this.isBudgetExceeded(),
      byKind: summarize(monthRows),
      byProvider: summarizeByProvider(monthRows),
    };
  }

  getSessionCost(sessionId: string): SessionCostDTO {
    const rows = usageRecordsRepository.listForSession(sessionId);
    return {
      sessionId,
      totalCostUsd: rows.reduce((sum, r) => sum + r.estimated_cost_usd, 0),
      requestCount: rows.length,
      byKind: summarize(rows),
    };
  }
}

export const costManager = new CostManager();
