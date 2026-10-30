import { vi } from 'vitest';

const longerThanTheTestMs = 120_000;

export function until<A>(check: () => A | Promise<A>): Promise<A> {
  return vi.waitFor(check, { timeout: longerThanTheTestMs, interval: 50 });
}
