import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runCacheOf } from '../cache/run-cache.ts';
import { pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun } from '../machine/run-state.ts';
import type { MemoryEngine } from '../memory/memory-ports.ts';
import { countedReservedSandbox, testDriverOf } from '../pool-testing/test-sandbox.ts';
import { evolveRun, loadedRunOf } from '../run-log/run-fold.ts';
import { snapshotEveryBytes } from '../run-log/snapshot.ts';
import { startedOf, testMachineOf } from '../testing/driver-inputs.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId, outputKindsIn, drivenRunId as runId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowEngineOf } from './engine.ts';

const answeringLarge = () => ({ after: 1000, result: { status: 'succeeded', output: 'x'.repeat(300_000) } }) as const;

const callingInALoop = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2, 3, 4, 5, 6, 7, 8] }' }
      do:
        - ask: { call: notify, with: { to: ada }, output: { as: '\${ ({ last: $data }) }' } }
  - done: { set: { done: true } }
`);

function snapshotVersionOf(driver: MemoryDriver): number {
  return driver.ports.runStore.snapshotOf(runId)?.snapshot.version ?? 0;
}

function untilTheFirstSnapshot(driver: MemoryDriver): number {
  return snapshotVersionOf(driver) === 0 && driver.clock.advance()
    ? untilTheFirstSnapshot(driver)
    : snapshotVersionOf(driver);
}

const inputs = 130;

const paddingCharacters = 8000;

const runIdLongRun = '0199a3c4-7d2e-7c1a-9b3f-000000003000';

const ticking = workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1, padding: "x".repeat(${paddingCharacters}) }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < ${inputs - 1} }', then: tick } }] }
`);

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

describe('the snapshots of a run', () => {
  it('are saved once the events since the last take as many bytes, and give the state its whole stream gives', () => {
    const driver = testDriverOf({ respond: answeringLarge });
    driver.start({ runId, document: callingInALoop });

    const ended = driver.runUntilEnded(runId);
    const events = driver.ports.runStore.events(runId);
    const fromSnapshot = loadedRunOf(Effect.runSync(driver.ports.runStore.load(runId)));

    expect(ended.outcome).toEqual({ kind: 'completed', output: { done: true } });
    expect(snapshotVersionOf(driver)).toBeGreaterThan(1);
    expect(snapshotVersionOf(driver)).toBeLessThan(events.length);
    expect(fromSnapshot.state).toEqual(statesAlong(events).at(-1));
    expect(fromSnapshot.version).toBe(events.length);
  });

  it('let the input that follows one be decided from it alone', () => {
    const driver = testDriverOf({ respond: answeringLarge });
    driver.start({ runId, document: callingInALoop });
    const snapshotAt = untilTheFirstSnapshot(driver);

    expect(Effect.runSync(driver.ports.runStore.load(runId)).tail).toEqual([]);
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: { done: true } });
    expect(driver.ports.runStore.events(runId).length).toBeGreaterThan(snapshotAt);
  });
});

describe('the dispatch of a run', () => {
  it('sends again, with the next input, the outputs of an event whose dispatch stopped before they went out', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - pause: { wait: PT1M }
          - await: { listen: { to: { one: { with: { type: go } } } } }
`);
    const driver = testDriverOf();
    driver.ports.faults.failNext('arm_timer');
    driver.start({ runId, document });
    const dispatchedBefore = driver.ports.faults.dispatched().length;
    driver.deliver(runId, { id: 'e1', type: 'go' });

    expect(dispatchedBefore).toBe(0);
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: [{}, [null]] });
  });

  it('settles again, when woken, a settlement whose dispatch failed', () => {
    const driver = testDriverOf();
    driver.ports.faults.failNext('settle');
    driver.start({ runId, document: workflow('do:\n  - greet: { set: { done: true } }') });
    const before = driver.ports.recordStore.settlementOf(runId);

    const woken = Effect.runSync(driver.engine.wake(runId));

    expect(before).toBeUndefined();
    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(driver.ports.recordStore.settlementOf(runId)).toEqual({ status: 'succeeded', output: { done: true } });
  });

  it('reports a settle receipt that troubles, and does not drop it', () => {
    const driver = testDriverOf();
    driver.submit(startedOf({ runId, document: workflow('do:\n  - greet: { set: { done: true } }') }, 0));

    expect(driver.ports.reporter.reports()).toEqual([{ run: { runId, attributes: {} }, receipt: 'unknown_run' }]);
    expect(outputKindsIn(driver.ports.runStore.events(runId))).toEqual(['settle']);
  });
});

describe(`a run of ${inputs} inputs of ${paddingCharacters} characters each`, () => {
  it('resumes from its last snapshot and the events after it alone, to the state its whole stream folds to', () => {
    const driver = testDriverOf();
    driver.start({ runId: runIdLongRun, document: ticking });
    driver.runUntilEnded(runIdLongRun);
    const events = driver.ports.runStore.events(runIdLongRun);
    const stored = Effect.runSync(driver.ports.runStore.load(runIdLongRun));

    const resumed = loadedRunOf(stored);

    expect(events).toHaveLength(inputs);
    expect(stored.snapshot?.snapshot.version).toBeGreaterThan(inputs / 2);
    expect(resumed.sinceSnapshot.bytes).toBeLessThan(snapshotEveryBytes);
    expect(resumed.version).toBe(inputs);
    expect(resumed.state).toEqual(events.reduce((state, { event }) => evolveRun(state, event), newRun));
  });
});

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
