import { describe, expect, it } from 'vitest';

import { steppedUntilSaid, type HostProcess } from './host-processes.ts';

/** A process that says nothing, however far its host is stepped, counting the steps it is given. */
function silentProcess(stepped: (milliseconds: number) => void): HostProcess {
  return {
    said: () => Promise.withResolvers<void>().promise,
    hasSaid: () => false,
    stepped: (milliseconds) => {
      stepped(milliseconds);
      return Promise.resolve();
    },
    killed: () => Promise.resolve(),
    ended: () => Promise.resolve(0),
    exited: Promise.resolve(0),
  };
}

describe('the steps a test gives the host of another process until it says a line', () => {
  it('stop at the most the test allows, and then fail saying how far they stepped', async () => {
    const steps: number[] = [];

    const failed = await steppedUntilSaid(
      silentProcess((milliseconds) => {
        steps.push(milliseconds);
      }),
      'settled',
      { everyMs: 20, atMost: 3 },
    ).catch((error: unknown) => error);

    expect([failed, steps]).toEqual([expect.any(Error), [20, 20, 20]]);
  });
});
