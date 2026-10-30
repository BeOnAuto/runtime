import { describe, expect, it } from 'vitest';

import type { RunInput } from '../machine/run-input.ts';
import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import { startedOf, testCancel } from '../testing/driver-inputs.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { armedTimerIds, drivenRunId as runId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const document = workflow(`
do:
  - both:
      fork:
        branches:
          - ask: { call: notify, with: { to: ada } }
          - pause: { wait: PT1H }
          - await: { listen: { to: { all: [{ with: { type: a } }, { with: { type: b } }] } } }
`);

function started(): MemoryDriver {
  const driver = testDriverOf({ respond: () => 'never' });
  driver.start({ runId, document });
  return driver;
}

function twice(driver: MemoryDriver, input: RunInput): readonly string[] {
  const before = driver.ports.runStore.events(runId).length;
  const outcomes = [driver.submit(input), driver.submit(input)].map((submission) => submission.outcome);
  return [...outcomes, `${driver.ports.runStore.events(runId).length - before} appended`];
}

function receiptsOf(driver: MemoryDriver): readonly string[] {
  return driver.ports.runStore
    .events(runId)
    .map(({ event }) => JSON.stringify([event.receipt.kind, event.receipt.key]));
}

describe('an input given twice is applied once', () => {
  it('when it starts the run', () => {
    const driver = started();

    expect(twice(driver, startedOf({ runId, document }, driver.clock.now()))).toEqual(['stale', 'stale', '0 appended']);
  });

  it('when it fires a timer', () => {
    const driver = started();
    const [timerId = ''] = armedTimerIds(driver.state(runId), 'wait');
    const at = driver.clock.now() + 3_600_000;

    expect(twice(driver, { kind: 'timer_fired', runId, at, timerId })).toEqual(['applied', 'stale', '1 appended']);
  });

  it('when it answers a call', () => {
    const driver = started();
    const key = { runId, reference: '/do/0/both/fork/branches/0/ask', run: 1 };
    const result = { status: 'succeeded', output: 1 } as const;

    expect(twice(driver, { kind: 'call_answered', runId, at: driver.clock.now(), key, result })).toEqual([
      'applied',
      'stale',
      '1 appended',
    ]);
  });
});

describe('an event or a cancel given twice is applied once', () => {
  it('when it delivers an event, which is counted once', () => {
    const driver = started();
    const event = { id: 'e1', type: 'b' };

    expect(twice(driver, { kind: 'event_received', runId, at: driver.clock.now(), event })).toEqual([
      'applied',
      'stale',
      '1 appended',
    ]);
    expect(driver.state(runId).inbox.received).toBe(1);
  });

  it('when it asks for a cancel', () => {
    const driver = started();

    expect(twice(driver, { kind: 'cancel_requested', runId, at: driver.clock.now(), cancel: testCancel })).toEqual([
      'applied',
      'stale',
      '1 appended',
    ]);
  });
});

describe('a stream', () => {
  it('has no two events with the same receipt', () => {
    const driver = testDriverOf({
      respond: () => ({ after: 5, result: { status: 'succeeded', output: 1 } }),
    });
    driver.start({ runId, document });
    for (const id of ['a', 'b']) {
      driver.at(10, () => {
        driver.deliver(runId, { id, type: id });
      });
    }
    driver.runUntilEnded(runId);
    const receipts = receiptsOf(driver);

    expect(new Set(receipts).size).toBe(receipts.length);
    expect(receipts.length).toBeGreaterThan(4);
  });

  it('takes nothing for a run that has not started, and says so', () => {
    expect(testDriverOf().cancel(runId)).toEqual({ outcome: 'not_started', version: 0 });
  });
});
