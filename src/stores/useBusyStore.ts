import { create } from "zustand";

// Aggregates background tasks scattered across components (such as model downloads
// or YouTube audio downloads) into a single "busy" indicator. Prevents conflicts
// with update downloads/restarts (avoiding temporary file collisions or corruption
// from abrupt termination). UpdateModal disables buttons based on this signal.
interface BusyState {
  reasons: Set<string>;
  markBusy: (id: string) => void;
  clearBusy: (id: string) => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  reasons: new Set(),
  markBusy: (id) => set((s) => ({ reasons: new Set(s.reasons).add(id) })),
  clearBusy: (id) =>
    set((s) => {
      if (!s.reasons.has(id)) return s;
      const next = new Set(s.reasons);
      next.delete(id);
      return { reasons: next };
    }),
}));
