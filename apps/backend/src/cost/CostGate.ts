import type { CostMode } from '@kvl/shared';
import { settingsRepository } from '../db/repositories/settingsRepository';
import { costManager } from './CostManager';

export interface CostGateLike {
  readonly mode: CostMode;
  /** True unless: budget exceeded (all modes, non-negotiable), local-only
   * mode is on (all modes, non-negotiable), or cost mode is 'economy'
   * (paid tier never attempted in economy, period). */
  isPaidTierAllowed(): boolean;
  /** Only lowers the bar for a NON-paid (requiresApiKey=false) provider's
   * result, and only in economy mode — since economy already hard-blocks
   * the paid tier via isPaidTierAllowed(), this exists purely so a
   * marginal local/free result doesn't get rejected into "no result at
   * all" (violates "never silently fail") when paid isn't an option
   * anyway. Never applied to a requiresApiKey provider's own confidence. */
  localAcceptanceThreshold(baseMinConfidence: number): number;
  /** Gates RequestCache reads/writes in TranslationRouter/ResponseRouter —
   * default true. */
  isCachingEnabled(): boolean;
}

const ECONOMY_THRESHOLD_DROP = 0.2;
const ECONOMY_THRESHOLD_FLOOR = 0.3;

class CostGate implements CostGateLike {
  private costMode: CostMode = 'balanced';
  private localOnlyMode = false;
  private cachingEnabled = true;

  refreshSettings(): void {
    const settings = settingsRepository.getAll();
    this.costMode = settings.costMode === 'economy' || settings.costMode === 'quality' ? settings.costMode : 'balanced';
    this.localOnlyMode = settings.localOnlyMode === true;
    this.cachingEnabled = settings.enableCaching !== false; // default true
  }

  isCachingEnabled(): boolean {
    return this.cachingEnabled;
  }

  get mode(): CostMode {
    return this.costMode;
  }

  isLocalOnly(): boolean {
    return this.localOnlyMode;
  }

  isPaidTierAllowed(): boolean {
    if (this.localOnlyMode) return false;
    if (this.costMode === 'economy') return false;
    if (costManager.isBudgetExceeded()) return false;
    return true;
  }

  localAcceptanceThreshold(baseMinConfidence: number): number {
    if (this.costMode !== 'economy') return baseMinConfidence;
    return Math.max(ECONOMY_THRESHOLD_FLOOR, baseMinConfidence - ECONOMY_THRESHOLD_DROP);
  }
}

export const costGate = new CostGate();

/** Permissive default for routers constructed without an explicit gate
 * (every existing *.node-test.ts constructs routers directly with fake
 * providers, no DB — this keeps that behavior byte-for-byte unchanged). */
export const PASSTHROUGH_COST_GATE: CostGateLike = {
  mode: 'balanced',
  isPaidTierAllowed: () => true,
  localAcceptanceThreshold: (base) => base,
  isCachingEnabled: () => false, // existing *.node-test.ts files never expect caching unless a real cache is explicitly injected
};
