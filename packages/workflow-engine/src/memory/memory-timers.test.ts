import { setImmediate } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { timerProbes, type TimerSubject } from '../testing/port-probes.ts';
import { faultsOf, memoryTimers } from './memory-timers.ts';
import { virtualClock, type VirtualClock } from './virtual-clock.ts';

const run = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

const otherRun = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b', attributes: {} };

async function settledOf(clock: VirtualClock, take: () => readonly string[]): Promise<readonly string[]> {
  await setImmediate();
  return clock.advance() ? settledOf(clock, take) : take();
}

function timerSubject(): TimerSubject {
  const clock = virtualClock();
  const fired: string[] = [];
  const timers = memoryTimers(
    clock,
    (input) => {
      fired.push(input.kind === 'timer_fired' ? input.timerId : input.kind);
    },
    faultsOf(clock),
  );
  return {
    timers,
    run,
    otherRun,
    now: clock.now,
    settle: () => Effect.promise(() => settledOf(clock, () => fired.splice(0))),
  };
}

describe('the memory timers meet the contract every timer store meets', () => {
  it.each(timerProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(timerSubject()))).toEqual(probe.expected);
  });
});
