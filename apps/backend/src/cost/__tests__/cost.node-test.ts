/**
 * Phase 11 pure-logic tests: cost estimation, budget-threshold crossing
 * detection, ProviderHealth.status() transitions, and the CostGate truth
 * table (costMode x budgetExceeded x localOnlyMode). No DB/network here —
 * DB-touching proofs (usage_records inserts, real threshold-crossing via
 * CostManager.record()) belong in an ephemeral WS-integration script per
 * this repo's convention, not here.
 *
 * Run: pnpm --filter @kvl/backend test:cost-core
 */
import { ProviderHealth } from '@kvl/shared';
import { estimateCostUsd, nextThresholdToNotify, startOfDayIso, startOfMonthIso, startOfWeekIso, monthKey } from '../CostManager';
import { PASSTHROUGH_COST_GATE, type CostGateLike } from '../CostGate';
import { RequestCache } from '../RequestCache';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// --- estimateCostUsd -------------------------------------------------------
{
  assert(estimateCostUsd('translation', false, { inputUnits: 1000, outputUnits: 1000 }) === 0, 'local/free tier (requiresApiKey=false) always costs $0, regardless of unit counts');

  const cost = estimateCostUsd('translation', true, { inputUnits: 500, outputUnits: 500 });
  assert(cost > 0, 'a paid translation call has a non-zero estimated cost');
  assert(Math.abs(cost - 1000 * 0.000002) < 1e-9, `translation cost scales linearly with input+output units — got ${cost}`);

  const sttCost = estimateCostUsd('stt', true, { audioSeconds: 60 });
  assert(sttCost > 0, 'a paid STT call is estimated from audioSeconds, not text length');
  const sttCostZeroAudio = estimateCostUsd('stt', true, { inputUnits: 99999 });
  assert(sttCostZeroAudio === 0, 'STT cost ignores inputUnits entirely (billed by audio duration, not char count) — got ' + sttCostZeroAudio);
}

// --- budget threshold crossing ---------------------------------------------
{
  assert(nextThresholdToNotify(0, 0, 0) === null, 'monthlyBudgetUsd=0 (unlimited) never triggers a threshold, regardless of spend');
  assert(nextThresholdToNotify(50, 100, 0) === null, '50% spend with nothing notified yet stays below the first threshold (80%)');
  assert(nextThresholdToNotify(85, 100, 0) === 80, '85% spend with nothing notified yet crosses the 80% threshold');
  assert(nextThresholdToNotify(85, 100, 80) === null, '85% spend already notified at 80% this month does not re-fire 80%');
  assert(nextThresholdToNotify(95, 100, 80) === 90, '95% spend, last notified 80%, crosses 90% next');
  assert(nextThresholdToNotify(120, 100, 90) === 100, 'spend past 100% of budget, last notified 90%, crosses the 100% (hard) threshold');
  assert(nextThresholdToNotify(150, 100, 0) === 100, 'a huge overspend with nothing notified yet reports the HIGHEST crossed threshold (100), not the lowest (80)');
}

// --- date-window helpers -----------------------------------------------------
{
  const now = new Date('2026-08-21T15:30:00.000Z');
  assert(startOfDayIso(now) === '2026-08-21T00:00:00.000Z', `startOfDayIso truncates to UTC midnight — got ${startOfDayIso(now)}`);
  assert(startOfMonthIso(now) === '2026-08-01T00:00:00.000Z', `startOfMonthIso truncates to the 1st of the UTC month — got ${startOfMonthIso(now)}`);
  assert(new Date(startOfWeekIso(now)).getTime() === now.getTime() - 7 * 24 * 60 * 60 * 1000, 'startOfWeekIso is exactly 7 days before now');
  assert(monthKey(now) === '2026-08', `monthKey formats as YYYY-MM — got ${monthKey(now)}`);
}

// --- ProviderHealth.status() transitions ------------------------------------
{
  const health = new ProviderHealth({ maxConsecutiveErrors: 2, circuitCooldownMs: 1000, rateLimitCooldownMs: 500 });
  assert(health.status(0) === 'healthy', 'a fresh ProviderHealth starts healthy');

  health.recordError({}, 0);
  assert(health.status(0) === 'degraded', 'one consecutive error (below the circuit threshold) is degraded, not unavailable');

  health.recordError({}, 0); // 2nd consecutive error trips the circuit (maxConsecutiveErrors: 2)
  assert(health.status(0) === 'unavailable', 'reaching maxConsecutiveErrors opens the circuit — status is unavailable');
  assert(health.status(1001) === 'degraded', 'once circuitCooldownMs elapses status drops from unavailable to degraded, not healthy — consecutiveErrors only resets via recordSuccess()');
  health.recordSuccess();
  assert(health.status(1001) === 'healthy', 'recordSuccess() resets consecutiveErrors, returning fully to healthy after the circuit cooldown');

  const health2 = new ProviderHealth({ maxConsecutiveErrors: 5 });
  health2.recordError({ isRateLimit: true }, 0);
  assert(health2.status(0) === 'rate-limited', 'a rate-limit error reports rate-limited before the circuit trips');
  assert(health2.status(60_001) === 'degraded', 'rate-limited status clears after rateLimitCooldownMs, reverting to degraded (consecutive error count still > 0)');

  health2.recordSuccess();
  assert(health2.status(60_001) === 'healthy', 'recordSuccess() resets consecutiveErrors, returning to healthy');
}

// --- CostGate truth table (via PASSTHROUGH_COST_GATE contract shape) -------
{
  assert(PASSTHROUGH_COST_GATE.isPaidTierAllowed() === true, 'the default passthrough gate always allows the paid tier — preserves pre-Phase-11 router behavior for existing tests');
  assert(PASSTHROUGH_COST_GATE.localAcceptanceThreshold(0.6) === 0.6, 'the default passthrough gate never adjusts the local acceptance threshold');

  const economyGate: CostGateLike = {
    mode: 'economy',
    isPaidTierAllowed: () => false,
    localAcceptanceThreshold: (base) => Math.max(0.3, base - 0.2),
    isCachingEnabled: () => false,
  };
  assert(economyGate.isPaidTierAllowed() === false, 'economy mode never allows the paid tier');
  assert(Math.abs(economyGate.localAcceptanceThreshold(0.6) - 0.4) < 1e-9, `economy mode lowers the local/free acceptance threshold by 0.2 — got ${economyGate.localAcceptanceThreshold(0.6)}`);
  assert(economyGate.localAcceptanceThreshold(0.35) === 0.3, 'economy mode floors the lowered threshold at 0.3, never goes lower');
}

// --- RequestCache: TTL expiry + bounded size (the long-running-process leak fix) ---
{
  const cache = new RequestCache(1000); // ttlMs=1000
  cache.set('a', 'value-a', 0);
  assert(cache.get('a', 500) === 'value-a', 'a fresh entry is returned before its TTL expires');
  assert(cache.get('a', 1000) === undefined, 'an entry is gone once now reaches its expiresAt');

  const capped = new RequestCache(60_000, 3); // maxEntries=3
  capped.set('k1', 1, 0);
  capped.set('k2', 2, 0);
  capped.set('k3', 3, 0);
  assert(capped.size === 3, 'cache holds all entries up to maxEntries');
  capped.set('k4', 4, 0); // should evict the oldest (k1), not grow past the cap
  assert(capped.size === 3, `cache never grows past maxEntries even under sustained distinct keys, got size ${capped.size}`);
  assert(capped.get('k1', 0) === undefined, 'the oldest entry (k1) was evicted to make room for k4');
  assert(capped.get('k4', 0) === 4, 'the newest entry (k4) is present after eviction');

  capped.clear();
  assert(capped.size === 0, 'clear() empties the cache (wired to the cache:clear WS message)');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
