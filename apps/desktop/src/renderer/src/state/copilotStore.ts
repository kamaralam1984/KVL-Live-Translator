import { create } from 'zustand';
import type { CopilotItemDTO } from '@kvl/shared';

interface CopilotState {
  items: CopilotItemDTO[];
  isCollapsed: boolean;

  /** Bulk replace — reply to copilot:list on screen mount/session resume. */
  setItems: (items: CopilotItemDTO[]) => void;
  /** Append-or-replace by id — used for both new detections (copilot:item)
   * and edits (copilot:updated), since both are "here's the current state
   * of this item" broadcasts. */
  upsertItem: (item: CopilotItemDTO) => void;
  removeItem: (itemId: string) => void;
  toggleCollapsed: () => void;
  clear: () => void;
}

export const useCopilotStore = create<CopilotState>((set) => ({
  items: [],
  isCollapsed: false,

  setItems: (items) => set({ items }),
  upsertItem: (item) =>
    set((state) => {
      const index = state.items.findIndex((i) => i.id === item.id);
      if (index === -1) return { items: [...state.items, item] };
      const items = [...state.items];
      items[index] = item;
      return { items };
    }),
  removeItem: (itemId) => set((state) => ({ items: state.items.filter((i) => i.id !== itemId) })),
  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
  clear: () => set({ items: [] }),
}));
