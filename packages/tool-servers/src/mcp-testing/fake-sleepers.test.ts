import { describe, expect, it } from 'vitest';

import { manualSleepers, realSleep } from './fake-sleepers.ts';

describe('the sleepers of a fake served in process', () => {
  it('sleep until they are woken, and a sleeper whose call is cancelled wakes to the reason, never later', async () => {
    const sleepers = manualSleepers();
    const cancelling = new AbortController();
    const reason = new Error('cancelled');

    const woken = sleepers.sleep(5000, new AbortController().signal);
    const cancelled = sleepers.sleep(5000, cancelling.signal);
    await sleepers.waited(2);
    cancelling.abort(reason);
    sleepers.fire();

    await expect(woken).resolves.toBeUndefined();
    await expect(cancelled).rejects.toBe(reason);
  });
});

describe('the real sleep, which a fake served on a socket or over stdio keeps', () => {
  it('ends after the milliseconds it is given, and at once with the reason its call is cancelled for', async () => {
    const reason = new Error('cancelled');

    await expect(realSleep(0, new AbortController().signal)).resolves.toBeUndefined();
    await expect(realSleep(5000, AbortSignal.abort(reason))).rejects.toMatchObject({ cause: reason });
  });
});
