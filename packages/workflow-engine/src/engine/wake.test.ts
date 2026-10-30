import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryPorts } from '../memory/memory-ports.ts';
import { virtualClock } from '../memory/virtual-clock.ts';
import { testDriverOf, testMachine } from '../pool-testing/test-sandbox.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowEngineOf } from './engine.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1M }');

describe('a run whose note of its due time failed', () => {
  it('is found by a sweep an hour later, though nothing woke it and its alarm was lost, and runs to its end', () => {
    const driver = testDriverOf();
    driver.ports.faults.failNext('note_due');
    const started = driver.start({ runId, document: pausing });
    driver.ports.timers.forget();
    const stuck = driver.runUntilEnded(runId);

    const swept = Effect.runSync(driver.engine.sweep(driver.clock.now() + 3_600_000));

    expect(started).toEqual({ outcome: 'applied', version: 1 });
    expect(stuck.status).toBe('running');
    expect(swept).toEqual({ runs: 1, timersArmedAgain: 0 });
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: {} });
  });

  it('leaves its dispatch behind until a wake dispatches it again and notes its due time', () => {
    const driver = testDriverOf();
    driver.ports.faults.failNext('note_due');
    driver.start({ runId, document: pausing });

    const watermark = Effect.runSync(driver.ports.watermark.read(runId));
    const woken = Effect.runSync(driver.engine.wake(runId));
    const swept = Effect.runSync(driver.engine.sweep(driver.clock.now() + 3_600_000));

    expect(watermark).toBe(0);
    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(swept).toEqual({ runs: 1, timersArmedAgain: 0 });
  });

  it('is found by a sweep after a port failed too, though nothing woke it, and runs to its end', () => {
    const driver = testDriverOf();
    driver.ports.faults.failNext('arm_timer');
    driver.ports.faults.failNext('note_due');
    driver.start({ runId, document: pausing });
    const stuck = driver.runUntilEnded(runId);

    const swept = Effect.runSync(driver.engine.sweep(driver.clock.now()));

    expect(stuck.status).toBe('running');
    expect(swept).toEqual({ runs: 1, timersArmedAgain: 0 });
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: {} });
  });
});

describe('a wake', () => {
  it('reads and moves the watermark of the run it was asked to wake, even one that has no event', () => {
    const asked: string[] = [];
    const clock = virtualClock();
    const ports = memoryPorts(
      clock,
      (input) => {
        asked.push(`submitted ${input.kind}`);
      },
      () => 'never',
    );
    const watermark = {
      ...ports.watermark,
      read: (id: string) => Effect.sync(() => asked.push(`read ${id}`)).pipe(Effect.as(0)),
      advance: (id: string, through: number) =>
        Effect.sync(() => {
          asked.push(`advance ${id} ${through}`);
        }),
    };
    const engine = workflowEngineOf({ ...ports, watermark }, testMachine);

    expect(Effect.runSync(engine.wake('a-run-with-no-events'))).toEqual({ version: 0, dispatchedThrough: 0 });
    expect(asked).toEqual(['read a-run-with-no-events', 'advance a-run-with-no-events 0']);
  });
});
