import type { ProviderKind } from './provider';

export type CostMode = 'economy' | 'balanced' | 'quality';

export interface UsageBreakdownEntry {
  key: string;
  requestCount: number;
  totalCostUsd: number;
}

export interface UsageSummaryDTO {
  todayCostUsd: number;
  weekCostUsd: number;
  monthCostUsd: number;
  monthRequestCount: number;
  localRequestCount: number;
  cloudRequestCount: number;
  localSharePercent: number;
  monthlyBudgetUsd: number;
  budgetPercentUsed: number;
  budgetExceeded: boolean;
  byKind: UsageBreakdownEntry[];
  byProvider: UsageBreakdownEntry[];
}

export interface SessionCostDTO {
  sessionId: string;
  totalCostUsd: number;
  requestCount: number;
  byKind: UsageBreakdownEntry[];
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'rate-limited' | 'unavailable' | 'disabled';

export interface ProviderHealthEntryDTO {
  providerId: string;
  kind: ProviderKind;
  label: string;
  status: ProviderHealthStatus;
  requestsInLastMinute: number;
  consecutiveErrors: number;
}
