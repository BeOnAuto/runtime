import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCacheOf } from '../cache/run-cache.ts';
import { pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { MemoryEngine } from '../memory/memory-ports.ts';
import { countedReservedSandbox } from '../pool-testing/test-sandbox.ts';
import { testMachineOf } from '../testing/driver-inputs.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { workflowEngineOf } from './engine.ts';

interface Counted {
  readonly engine: MemoryEngine;
  readonly prepared: () => number;
  readonly failingRead: () => void;
  readonly input: RunInput;
}

function countedEngine(): Counted {
  const driver = waitingOnItsPause();
  const { sandbox, prepared } = countedReservedSandbox();
  return {
    engine: workflowEngineOf(driver.ports, testMachineOf(sandbox), runCacheOf()),
    prepared,
    failingRead: () => {
      driver.ports.payloads.failNext('read');
    },
    input: pauseEnded(driver.state(drivenRunId)),
  };
}

async function failedTimes(counted: Counted, times: number): Promise<readonly number[]> {
  if (times === 0) {
    return [];
  }
  counted.failingRead();
  await Effect.runPromiseExit(counted.engine.submit(counted.input));
  return [counted.prepared(), ...(await failedTimes(counted, times - 1))];
}

describe('an input to a run whose kept values cannot be read just now', () => {
  it('sets no sandbox instance aside, so an outage holds none however many inputs it fails, and the input given again takes one', async () => {
    const counted = countedEngine();
    await Promise.resolve();

    const afterEachFailure = await failedTimes(counted, 5);
    const submitted = await Effect.runPromise(counted.engine.submit(counted.input));

    expect(afterEachFailure).toEqual([1, 1, 1, 1, 1]);
    expect([submitted.outcome, counted.prepared()]).toEqual(['applied', 2]);
  });
});
