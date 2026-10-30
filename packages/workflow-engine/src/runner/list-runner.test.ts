import { describe, expect, it } from 'vitest';

import { mostTasksPerInput } from '../machine/limits.ts';
import { drivenRun, stepsIn, timersArmedIn, timersCancelledIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function tasksCounting(count: number): string {
  return Array.from(
    { length: count },
    (_task, index) => `  - add${index}: { set: '\${ ({ count: ($data.count ?? 0) + 1 }) }' }`,
  ).join('\n');
}

const counting = `
          - counting:
              for: { in: '\${ Array.from({ length: 150 }, (_, index) => index) }' }
              do:
                - add: { set: '\${ ({ count: ($data.count ?? 0) + 1 }) }' }`;

describe('a list that would run more tasks than one input takes', () => {
  it(`runs ${mostTasksPerInput} tasks, then waits for a timer due at once before it goes on`, () => {
    const run = drivenRun(workflow(`do:\n${tasksCounting(150)}`));
    const firstTasks = new Set(stepsIn(run.events.slice(0, 1)).map(({ reference }) => reference));

    expect(run.outcome).toEqual({ kind: 'completed', output: { count: 150 } });
    expect(firstTasks.size).toBe(mostTasksPerInput);
    expect(timersArmedIn(run.events, 'yield')).toHaveLength(1);
  });

  it('is not woken by what is not its timer, and is cancelled while it waits for it', () => {
    const document = workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - await: { listen: { to: { one: { with: { type: go } } } } }${counting}
`);
    const run = drivenRun(document, {
      meanwhile: (driver, runId) => {
        driver.deliver(runId, { id: 'e1', type: 'go', data: 'won' });
      },
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: ['won'] });
    expect(stepsIn(run.events)).toContainEqual(
      expect.objectContaining({ reference: '/do/0/race/fork/branches/1/counting', run: 1, outcome: 'cancelled' }),
    );
  });
});

describe('a branch of a fork that waits to start', () => {
  it('is cancelled when another branch fails before it starts', () => {
    const document = workflow(`
do:
  - all:
      fork:
        branches:${counting}
          - refusing: { raise: { error: { type: https://example.com/refused, status: 409 } } }
          - later: { set: { later: true } }
`);
    const run = drivenRun(document);
    const laterStarts = timersArmedIn(run.events, 'yield')
      .filter(({ label }) => label === '/do/0/all/fork/branches/2/later lets other workflows run')
      .map(({ timerId }) => timerId);

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { type: 'https://example.com/refused' } });
    expect(laterStarts).toHaveLength(1);
    expect(timersCancelledIn(run.events).filter((timerId) => laterStarts.includes(timerId))).toEqual(laterStarts);
  });
});

describe('a do task', () => {
  it('runs its tasks in turn on its input', () => {
    const document = workflow(`
do:
  - steps:
      do:
        - first: { set: '\${ ({ count: $data.count + 1 }) }' }
        - second: { set: '\${ ({ count: $data.count + 1 }) }' }
`);

    expect(drivenRun(document, { input: { count: 0 } }).outcome).toEqual({ kind: 'completed', output: { count: 2 } });
  });

  it('ends its own list and goes on with the next task when a task exits', () => {
    const document = workflow(`
do:
  - steps:
      do:
        - leave: { set: { left: true }, then: exit }
        - skipped: { set: { skipped: true } }
  - after: { set: '\${ ({ after: $data.left }) }' }
`);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: { after: true } });
  });
});
