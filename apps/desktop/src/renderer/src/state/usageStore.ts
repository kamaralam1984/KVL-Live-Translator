import { create } from 'zustand';
import type { UsageSummaryDTO } from '@kvl/shared';

interface UsageState {
  usage: UsageSummaryDTO | null;
  setUsage: (usage: UsageSummaryDTO) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  usage: null,
  setUsage: (usage) => set({ usage }),
}));
