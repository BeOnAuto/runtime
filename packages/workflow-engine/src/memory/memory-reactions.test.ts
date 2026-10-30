import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ArmListener } from '../dispatch/run-output.ts';
import { emitterProbes, listenerProbes } from '../reactions/reaction-probes.ts';
import { memoryEmitter, memoryListeners } from './memory-reactions.ts';
import { faultsOf } from './memory-timers.ts';
import { virtualClock } from './virtual-clock.ts';

const run = { runId: 'acme/alpha/r1', attributes: {} };

const otherRun = { runId: 'acme/alpha/r2', attributes: {} };

describe('the listeners kept in memory', () => {
  it.each(listenerProbes)('$title', async (probe) => {
    const listeners = memoryListeners(faultsOf(virtualClock()));

    expect(await Effect.runPromise(probe.run({ listeners, run, otherRun }))).toEqual(probe.expected);
  });

  it('refuses a listener beyond the most it keeps, and remembers the version of the record that armed each', async () => {
    const listeners = memoryListeners(faultsOf(virtualClock()), 1);
    const listener = (reference: string): ArmListener => ({
      kind: 'arm_listener',
      key: { runId: run.runId, reference, run: 1 },
      filters: [],
    });

    const receipts = await Effect.runPromise(
      Effect.all([
        listeners.arm(listener('/do/0/a'), run, { version: 3 }),
        listeners.arm(listener('/do/0/b'), run, { version: 4 }),
      ]),
    );

    expect([receipts, listeners.armed().map(({ armedBy }) => armedBy)]).toEqual([['armed', 'refused'], [3]]);
  });
});

describe('the emitter kept in memory', () => {
  it.each(emitterProbes)('$title', async (probe) => {
    const emitter = memoryEmitter(faultsOf(virtualClock()));

    expect(await Effect.runPromise(probe.run({ emitter, run }))).toEqual(probe.expected);
    expect(emitter.emitted()).toHaveLength(1);
  });
});
