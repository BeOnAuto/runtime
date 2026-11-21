export interface Arrivals {
  readonly arrive: () => void;
  readonly count: () => number;
  readonly reached: (count: number) => Promise<void>;
}

export function arrivals(): Arrivals {
  const reaching = new Map<number, PromiseWithResolvers<void>>();
  const counted = { arrived: 0 };
  const at = (count: number) => {
    const reached = reaching.get(count) ?? Promise.withResolvers<void>();
    reaching.set(count, reached);
    return reached;
  };
  return {
    arrive: () => {
      counted.arrived += 1;
      at(counted.arrived).resolve();
    },
    count: () => counted.arrived,
    reached: (count) => (count <= counted.arrived ? Promise.resolve() : at(count).promise),
  };
}
