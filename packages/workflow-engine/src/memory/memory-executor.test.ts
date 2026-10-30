import { setImmediate } from 'node:timers/promises';

import type { CallResult } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callKeyText } from '../executor/call-key.ts';
import { executorProbes, type ExecutorSubject } from '../testing/port-probes.ts';
import { memoryExecutor } from './memory-executor.ts';
import { faultsOf } from './memory-timers.ts';
import { virtualClock, type VirtualClock } from './virtual-clock.ts';

const run = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

async function settledOf(clock: VirtualClock, take: () => readonly string[]): Promise<readonly string[]> {
  await setImmediate();
  return clock.advance() ? settledOf(clock, take) : take();
}

function executorSubject(): ExecutorSubject {
  const clock = virtualClock();
  const answered: string[] = [];
  const finishers = new Map<string, (result: CallResult) => void>();
  const later = (key: string): Promise<CallResult> =>
    new Promise((resolve) => {
      finishers.set(key, resolve);
    });
  const executor = memoryExecutor(
    clock,
    (input) => {
      answered.push(input.kind === 'call_answered' ? callKeyText(input.key) : input.kind);
    },
    (call) => ({ later: later(callKeyText(call.key)) }),
    faultsOf(clock),
  );
  return {
    executor,
    run,
    finish: (call, result) =>
      Effect.sync(() => {
        finishers.get(callKeyText(call.key))?.(result);
      }),
    loseHost: (call) =>
      Effect.sync(() => {
        executor.lose(call.key);
      }),
    settle: () => Effect.promise(() => settledOf(clock, () => answered.splice(0))),
  };
}

describe('the memory executor meets the contract every executor meets', () => {
  it.each(executorProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(executorSubject()))).toEqual(probe.expected);
  });
});
