type Release = () => void;

export interface ScoringPermits {
  readonly take: () => Release | null;
  readonly taken: () => number;
}

export function scoringPermits(size: number): ScoringPermits {
  const state = { taken: 0 };
  return {
    take: () => {
      if (state.taken >= size) {
        return null;
      }
      state.taken += 1;
      const once = { released: false };
      return () => {
        if (!once.released) {
          once.released = true;
          state.taken -= 1;
        }
      };
    },
    taken: () => state.taken,
  };
}
