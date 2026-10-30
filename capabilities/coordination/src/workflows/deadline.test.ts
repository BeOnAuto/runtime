import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

const threeHours = 10_800_000;

const stoppedAfter = threeHours;

describe('a workflow that runs up to the most it may run', () => {
  it('is stopped once it has run the most it may, exactly, and ends cancelled as overrun', async () => {
    const waiting = workflow('do:\n  - await: { listen: { to: { one: { with: { type: never } } } } }');
    const { ending, settlement, commands, fake } = await interpret(waiting, { mostDuration: threeHours });

    expect(commands[0]).toStrictEqual({ kind: 'deadline', milliseconds: stoppedAfter });
    expect(settlement).toStrictEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'overrun',
      detail: `The workflow ran for ${stoppedAfter} ms, the most a workflow may run, and was stopped`,
    });
    expect(ending).toStrictEqual({
      kind: 'failed',
      type: 'WorkflowRanTooLong',
      message: `The workflow ran for ${stoppedAfter} ms, the most it may run; it was stopped and its run ended cancelled`,
    });
    expect(fake.now() - Date.parse('2026-10-01T09:00:00.000Z')).toBe(stoppedAfter);
  });

  it('ends as it would when it finishes first', async () => {
    const { ending } = await interpret(workflow('do:\n  - pause: { wait: PT1H }'), { mostDuration: threeHours });

    expect(ending).toStrictEqual({ kind: 'completed', output: {} });
  });
});

describe('a duration computed longer than the most a workflow may run', () => {
  it('fails the task that computed it', async () => {
    const { settlement } = await interpret(workflow(`do:\n  - pause: { wait: '\${ "PT4H" }' }`), {
      mostDuration: threeHours,
    });

    expect(settlement).toStrictEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'A duration of the task, 14400000 ms, is longer than the 10800000 ms a workflow may run, at the step pause.',
    });
  });
});
