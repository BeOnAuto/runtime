import { describe, expect, it } from 'vitest';

import { manualSleepers } from './fake-sleepers.ts';

describe('the sleepers of a fake MCP server', () => {
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

  it('do not sleep for a call already cancelled, ending at once with its reason', async () => {
    const sleepers = manualSleepers();
    const reason = new Error('cancelled');

    await expect(sleepers.sleep(5000, AbortSignal.abort(reason))).rejects.toBe(reason);
  });
});
