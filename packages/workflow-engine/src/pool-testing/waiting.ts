import { getEventListeners } from 'node:events';

import { expect, vi } from 'vitest';

export const longerThanTheTestMs = 120_000;

export function until(event: () => boolean | Promise<boolean>): Promise<void> {
  return vi.waitFor(
    async () => {
      expect(await event()).toBe(true);
    },
    { timeout: longerThanTheTestMs, interval: 10 },
  );
}

export function isWatched(signal: Readonly<AbortSignal>): boolean {
  return getEventListeners(signal, 'abort').length > 0;
}
