import { expect, vi } from 'vitest';

export const longerThanTheTestMs = 120_000;

export function until<A>(check: () => A | Promise<A>): Promise<A>;
export function until<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
export function until<A>(read: () => A | Promise<A>, holds?: (value: A) => boolean): Promise<A> {
  return vi.waitFor(
    async () => {
      const value = await read();
      expect(holds?.(value) ?? true).toBe(true);
      return value;
    },
    { timeout: longerThanTheTestMs, interval: 50 },
  );
}
