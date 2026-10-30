import { expect, vi } from 'vitest';

const longerThanTheTestMs = 120_000;

export function until(holds: () => boolean): Promise<void> {
  return vi.waitFor(
    () => {
      expect(holds()).toBe(true);
    },
    { timeout: longerThanTheTestMs, interval: 10 },
  );
}
