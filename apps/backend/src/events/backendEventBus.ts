import { TypedEventBus, type TranscriptSegment } from '@kvl/shared';

export interface BackendEvents {
  /** Emitted by SpeechManager right after broadcasting transcript:update.
   * TranslationManager subscribes here — SpeechManager itself stays
   * translation-ignorant, so Phase 8/9 features can subscribe too without
   * touching the STT pipeline. */
  'transcript:produced': { segment: TranscriptSegment; sessionId: string };
  /** Emitted by CostManager.record() the first time a new 80/90/100% monthly
   * budget threshold is crossed (once per threshold per month). A ws-layer
   * subscriber turns this into a usage:threshold broadcast — CostManager
   * itself stays broadcast-ignorant, same separation as transcript:produced. */
  'usage:budget-threshold-crossed': { percent: 80 | 90 | 100; monthCostUsd: number; monthlyBudgetUsd: number };
}

export const backendEventBus = new TypedEventBus<BackendEvents>();
