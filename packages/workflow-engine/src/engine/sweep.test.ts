import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { DispatchFailed } from '../dispatch/dispatch-watermark.ts';
import type { RunInput } from '../machine/run-input.ts';
import { memoryPorts } from '../memory/memory-ports.ts';
import { virtualClock } from '../memory/virtual-clock.ts';
import { testDriverOf, testMachine } from '../pool-testing/test-sandbox.ts';
import { startedOf } from '../testing/driver-inputs.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowEngineOf } from './engine.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1M }');

function failingSweep() {
  return Effect.fail(new DispatchFailed({ output: 'arm_timer', detail: 'The timer store is down' }));
}

describe('a sweep', () => {
  it('wakes a run whose dispatch fell behind, which dispatches what it missed', () => {
    const driver = testDriverOf();
    driver.ports.faults.failNext('arm_timer');
    driver.start({ runId, document: pausing });

    expect(Effect.runSync(driver.engine.sweep(driver.clock.now()))).toEqual({ runs: 1, timersArmedAgain: 0 });
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: {} });
  });

  it('arms again the timers the timer store lost of a run that is overdue', () => {
    const driver = testDriverOf();
    driver.start({ runId, document: pausing });
    driver.ports.timers.forget();

    const stuck = driver.runUntilEnded(runId);
    const swept = Effect.runSync(driver.engine.sweep(driver.clock.now() + 120_000));

    expect(stuck.status).toBe('running');
    expect(swept).toEqual({ runs: 1, timersArmedAgain: 2 });
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: {} });
  });

  it('wakes no run that is not due', () => {
    const driver = testDriverOf();
    driver.start({ runId, document: pausing });

    expect(Effect.runSync(driver.engine.sweep(driver.clock.now()))).toEqual({ runs: 0, timersArmedAgain: 0 });
  });

  it('counts no timer armed again when the timer store cannot be swept', () => {
    const clock = virtualClock();
    const ignored: RunInput[] = [];
    const ports = memoryPorts(
      clock,
      (input) => {
        ignored.push(input);
      },
      () => 'never',
    );
    const engine = workflowEngineOf({ ...ports, timers: { ...ports.timers, sweep: failingSweep } }, testMachine);
    ports.recordStore.known(runId);
    Effect.runSync(engine.submit(startedOf({ runId, document: pausing }, clock.now())));

    expect(Effect.runSync(engine.sweep(clock.now() + 120_000))).toEqual({ runs: 1, timersArmedAgain: 0 });
  });
});

describe('a sweep after a timer fired', () => {
  it('wakes no run whose last timer fired while it went on to wait for an event', () => {
    const driver = testDriverOf();
    const listening = workflow(
      'do:\n  - pause: { wait: PT1M }\n  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }',
    );
    driver.start({ runId, document: listening });
    driver.clock.advance();

    expect(Object.values(driver.state(runId).timers.armed).map(({ purpose }) => purpose)).toEqual(['deadline']);
    expect(Effect.runSync(driver.engine.sweep(driver.clock.now() + 3_600_000))).toEqual({
      runs: 0,
      timersArmedAgain: 0,
    });
  });
});
