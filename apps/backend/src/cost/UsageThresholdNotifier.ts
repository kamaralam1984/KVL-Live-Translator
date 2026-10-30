import { backendEventBus } from '../events/backendEventBus';
import { broadcast } from '../ws/connectionRegistry';

/**
 * Turns CostManager's internal usage:budget-threshold-crossed event into a
 * ws broadcast — CostManager itself stays broadcast-ignorant (same
 * separation TranscriptPersistence.ts uses for transcript:produced).
 */
export function initUsageThresholdNotifier(): void {
  backendEventBus.on('usage:budget-threshold-crossed', ({ percent, monthCostUsd, monthlyBudgetUsd }) => {
    broadcast({ type: 'usage:threshold', percent, monthCostUsd, monthlyBudgetUsd });
  });
}
