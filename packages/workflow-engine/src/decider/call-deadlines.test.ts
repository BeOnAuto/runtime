import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunLimits } from '../machine/run-input.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

const twoCalls = workflow(`
do:
  - both:
      fork:
        branches:
          - quick: { call: notify, with: { to: ada } }
          - slow: { call: notify, with: { to: grace } }
`);

const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000061';

const pausingThenAsking = workflow('do:\n  - pause: { wait: PT1M }\n  - ask: { call: notify, with: { to: ada } }');

function startsIn(positioned: PositionedEvent | undefined) {
  return (positioned?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'start_call' ? [{ reference: output.key.reference, longestMs: output.longestMs }] : [],
  );
}

function waitOf(positioned: PositionedEvent | undefined): string {
  const armed = (positioned?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'arm_timer' && output.purpose === 'wait' ? [output.timerId] : [],
  );
  return String(armed[0]);
}

function deadlinesOf(limits: Partial<RunLimits>) {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
  driver.start({ runId, document: twoCalls, limits });
  const [first] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));
  return (first?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'start_call' ? [{ reference: output.key.reference, longestMs: output.longestMs }] : [],
  );
}

describe('the deadline of a call', () => {
  it('is the limit its task was given when the run started, and the run-wide one for a task given none', () => {
    expect(
      deadlinesOf({
        longestCallMs: 600_000,
        longestCallMsByTask: { '/do/0/both/fork/branches/0/quick': 70_000 },
      }),
    ).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 70_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 600_000 },
    ]);
  });

  it('is a millisecond at the least, for a call that starts when the run has no time left', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    driver.start({
      runId,
      document: pausingThenAsking,
      limits: { mostDurationMs: 60_000, longestCallMs: 600_000 },
    });
    const [first] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));
    driver.submit({
      kind: 'timer_fired',
      runId,
      at: Number(first?.event.receipt.at) + 90_000,
      timerId: waitOf(first),
    });
    const [, second] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));

    expect(startsIn(second)).toEqual([{ reference: '/do/1/ask', longestMs: 1 }]);
  });

  it('is cut to what the run has left to run', () => {
    expect(deadlinesOf({ mostDurationMs: 45_000, longestCallMs: 600_000 })).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 45_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 45_000 },
    ]);
  });
});
