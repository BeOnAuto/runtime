import { describe, expect, it } from 'vitest';

import { circuitBreakers } from './circuit-breakers.ts';

describe('a circuit breaker per key', () => {
  it('is closed until opened, open for its period, half open after it, and closed again when told', () => {
    const breakers = circuitBreakers(1000);
    const before = breakers.stateAt('a', 0);
    breakers.opened('a', 10);
    const states = [breakers.stateAt('a', 1009), breakers.stateAt('a', 1010), breakers.stateAt('b', 1009)];
    breakers.closed('a');

    expect([before, ...states, breakers.stateAt('a', 1011)]).toEqual([
      'closed',
      'open',
      'half_open',
      'closed',
      'closed',
    ]);
  });
});
