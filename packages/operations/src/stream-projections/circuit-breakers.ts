type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakers {
  readonly stateAt: (key: string, at: number) => CircuitState;
  readonly opened: (key: string, at: number) => void;
  readonly closed: (key: string) => void;
}

export function circuitBreakers(openForMs: number): CircuitBreakers {
  const openedAt = new Map<string, number>();
  return {
    stateAt: (key, at) => {
      const since = openedAt.get(key);
      if (since === undefined) {
        return 'closed';
      }
      return at - since < openForMs ? 'open' : 'half_open';
    },
    opened: (key, at) => {
      openedAt.set(key, at);
    },
    closed: (key) => {
      openedAt.delete(key);
    },
  };
}

export const readModelOpenForMs = 3_600_000;
