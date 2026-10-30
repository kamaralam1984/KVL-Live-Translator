import { transcriptSegmentsRepository } from '../db/repositories/transcriptSegmentsRepository';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { childLogger } from '../logger';

const log = childLogger('transcript-retention');
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours — the one real setInterval, in this outer orchestrator

export type TranscriptRetentionPolicy = 'session' | '1day' | '7days' | '30days' | 'never';

/** Pure — deterministic via an explicit `now`, same convention as
 * CostManager's date-window helpers. 'session'/'never' have no fixed cutoff
 * (handled separately: 'session' deletes immediately on session:end,
 * 'never' never sweeps at all) so they return null here. */
export function retentionCutoffIso(policy: TranscriptRetentionPolicy, now: Date): string | null {
  const days: Record<'1day' | '7days' | '30days', number> = { '1day': 1, '7days': 7, '30days': 30 };
  if (policy === 'session' || policy === 'never') return null;
  const cutoffMs = now.getTime() - days[policy] * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

function currentPolicy(): TranscriptRetentionPolicy {
  const settings = settingsRepository.getAll();
  const policy = settings.transcriptRetentionPolicy;
  if (policy === 'session' || policy === '1day' || policy === '7days' || policy === '30days' || policy === 'never') return policy;
  return 'never'; // default — unchanged from pre-Phase-13 behavior (no auto-delete) unless the user opts in
}

function sweepOnce(): void {
  const policy = currentPolicy();
  const cutoff = retentionCutoffIso(policy, new Date());
  if (cutoff === null) return; // 'session' and 'never' have nothing to sweep here

  const deleted = transcriptSegmentsRepository.deleteOlderThan(cutoff);
  if (deleted > 0) log.info({ policy, cutoff, deleted }, 'transcript retention sweep deleted old segments');
}

/** Called once at boot (index.ts) — starts the periodic sweep and runs one
 * immediately so a policy change takes effect without waiting up to 6h. */
export function initTranscriptRetentionSweep(): void {
  sweepOnce();
  setInterval(sweepOnce, SWEEP_INTERVAL_MS);
}

/** Called from protocolHandlers.ts's 'session:end' case — the 'session'
 * policy's immediate-delete semantics, distinct from the periodic sweep
 * above (which only handles the day-based policies). */
export function deleteTranscriptIfSessionPolicy(sessionId: string): void {
  if (currentPolicy() !== 'session') return;
  const deleted = transcriptSegmentsRepository.deleteBySession(sessionId);
  if (deleted > 0) log.info({ sessionId, deleted }, "'session' retention policy deleted this session's transcript on session:end");
}
