import { expect, vi } from 'vitest';

const longerThanTheTestMs = 120_000;

export function until<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A> {
  return vi.waitFor(
    async () => {
      const value = await read();
      expect(holds(value)).toBe(true);
      return value;
    },
    { timeout: longerThanTheTestMs, interval: 50 },
  );
}
