import type { DueWork } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { bookOf, controls, sales } from '../assessor/assessor-ledger.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { clockHarnessOf } from './clock-harness.ts';
import type { ClockPorts } from './clock-judging.ts';
import { goalsClockOf } from './goals-clock.ts';

const checking = [{ goal: 'controls-hold', purpose: 'Checks every control each morning.', measures: '/failed' }];

function idle(ports: ClockPorts): DueWork {
  const clock = goalsClockOf(ports);
  return {
    ...clock,
    due: (now, most, callsOut) =>
      Effect.map(clock.due(now, most, callsOut), (items) =>
        items.map((item) => ({ ...item, perform: () => Effect.void })),
      ),
  };
}

describe('the harness of the clock', () => {
  it('fails a moment at which a perform left its row due, as a host would spin on it', async () => {
    const harness = clockHarnessOf('2026-11-08T07:00:00.000Z', bookOf(), idle);
    await harness.book.workflowSaved('check', 1, checking);

    await expect(harness.goalsSaved([controls], '2026-11-09T00:00:00.000Z')).rejects.toThrow(
      `Rows left due at 2026-11-09T00:00:00.000Z: ${sales.org}/${sales.playbook}/${clocksName}/${clockKey}`,
    );
  });
});
