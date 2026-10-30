import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import { testDriverOf, testWorkflowMachine } from '../pool-testing/test-sandbox.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import { testCancel } from '../testing/driver-inputs.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { armedTimerIds, drivenRunId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function cancelAt(at: number): RunInput {
  return { kind: 'cancel_requested', runId: drivenRunId, at, cancel: testCancel };
}

const elsewhere = { cause: { kind: 'none' as const }, attributes: {} };

function appendedElsewhere(driver: MemoryDriver, events: readonly RunLogEvent[]): void {
  Effect.runSync(
    Effect.forEach(events, (event) =>
      driver.ports.runStore.append(
        drivenRunId,
        event,
        { expectedVersion: 1, context: { at: '2026-10-01T09:00:00.000Z', by: 'tester' } },
        elsewhere,
      ),
    ),
  );
}

function ticking(times: number): ReturnType<typeof workflow> {
  return workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1 }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < ${times} }', then: tick } }] }
`);
}

function startedTicking(times: number): MemoryDriver {
  const driver = testDriverOf();
  driver.start({ runId: drivenRunId, document: ticking(times) });
  return driver;
}

function advancedToTheEnd(driver: MemoryDriver): void {
  let advancing = true;
  while (advancing) {
    advancing = driver.clock.advance();
  }
}

function storedState(driver: MemoryDriver): RunState {
  return statesAlong(driver.ports.runStore.events(drivenRunId)).at(-1) ?? newRun;
}

function decidedElsewhere(driver: MemoryDriver, input: RunInput): readonly RunLogEvent[] {
  return Result.getOrThrow(testWorkflowMachine.decide(input, storedState(driver)));
}

function armedTick(driver: MemoryDriver): string {
  const [timerId = ''] = armedTimerIds(storedState(driver), 'wait');
  return timerId;
}

function fired(timerId: string, at: number): RunInput {
  return { kind: 'timer_fired', runId: drivenRunId, at, timerId };
}

describe('an input to a run the engine keeps', () => {
  it('loads neither the snapshot nor the events the inputs before it left', () => {
    const driver = startedTicking(20);
    advancedToTheEnd(driver);
    const events = driver.ports.runStore.events(drivenRunId);

    expect(statesAlong(events).at(-1)?.outcome).toEqual({ kind: 'completed', output: { n: 20 } });
    expect(events).toHaveLength(21);
    expect(driver.ports.runStore.loads(drivenRunId)).toBe(1);
  });

  it('loads the run again once its stream moved past the version the engine keeps', () => {
    const driver = startedTicking(3);
    const at = driver.clock.now();
    const written = decidedElsewhere(driver, cancelAt(at));
    appendedElsewhere(driver, written);

    const answer = driver.submit(cancelAt(at + 1));

    expect(answer).toEqual({ outcome: 'stale', version: 2 });
    expect(driver.ports.runStore.loads(drivenRunId)).toBe(2);
  });

  it('takes an input another host made possible, since its stream moved past the version the engine keeps', () => {
    const driver = startedTicking(3);
    const firstTick = armedTick(driver);
    const written = decidedElsewhere(driver, fired(firstTick, driver.clock.now() + 1000));
    appendedElsewhere(driver, written);
    const secondTick = armedTick(driver);

    const answer = driver.submit(fired(secondTick, driver.clock.now() + 2000));

    expect(secondTick).not.toBe(firstTick);
    expect(answer).toEqual({ outcome: 'applied', version: 3 });
    expect(driver.ports.runStore.events(drivenRunId)).toHaveLength(3);
  });

  it('loads the run from the store when its append meets a conflict, rather than decide again on what it kept', () => {
    const driver = startedTicking(3);
    driver.ports.runStore.failNextAppend('conflict');

    const answer = driver.cancel(drivenRunId);

    expect(answer).toEqual({ outcome: 'applied', version: 2 });
    expect(driver.ports.runStore.loads(drivenRunId)).toBe(2);
  });
});
