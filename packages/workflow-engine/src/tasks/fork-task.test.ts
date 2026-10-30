import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { drivenRun, outputKindsIn, stepsIn, stepsWith, timersArmedIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const failing = { after: 10, result: { status: 'failed', detail: 'broke' } } as const;

const reachedAfter = '\n  - after: { set: { reached: true } }';

function indented(branches: readonly string[]): string {
  return branches.map((branch) => `          - ${branch}`).join('\n');
}

function forking(branches: readonly string[], timeout = '', after = ''): JsonObject {
  return workflow(`do:\n  - both:${timeout}\n      fork:\n        branches:\n${indented(branches)}${after}`);
}

function competing(branches: readonly string[], after = ''): JsonObject {
  return workflow(
    `do:\n  - race:\n      fork:\n        compete: true\n        branches:\n${indented(branches)}${after}`,
  );
}

const waitingAndAsking = ['waiting: { wait: PT1H }', 'asking: { call: notify, with: { to: ada } }'];

const counting =
  "counting: { for: { in: '${ Array.from({ length: 150 }, (_, index) => index) }' }, do: [{ add: { set: '${ ({ count: ($data.count ?? 0) + 1 }) }' } }] }";

describe('a fork', () => {
  it('runs every branch and gives their outputs in the order of the branches', () => {
    const document = forking([
      `slow: { wait: PT1M, output: { as: '\${ "slow" }' } }`,
      'quick: { set: { quick: true } }',
    ]);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: ['slow', { quick: true }] });
  });

  it('ends the workflow when a branch ends it', () => {
    const document = forking(
      ['stop: { set: { stopped: true }, then: end }', 'other: { set: { other: true } }'],
      '',
      reachedAfter,
    );

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: [{ stopped: true }, { other: true }] });
  });

  it('lets branches that would pass the tasks of one input wait for a timer due at once', () => {
    const run = drivenRun(forking([counting, 'other: { set: { other: true } }']));

    expect(run.outcome).toEqual({ kind: 'completed', output: [{ count: 150 }, { other: true }] });
    expect(timersArmedIn(run.events, 'yield').length).toBeGreaterThanOrEqual(2);
  });
});

describe('a fork whose branch fails', () => {
  it('cancels the branches still running, and raises its error', () => {
    const run = drivenRun(forking(waitingAndAsking), { respond: () => failing });
    const lastEvents = run.events.slice(-1);
    const cancelled = { reference: '/do/0/both/fork/branches/0/waiting', run: 1, outcome: 'cancelled' };

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { title: 'The function notify failed' } });
    expect(outputKindsIn(lastEvents)).toEqual(['cancel_timer', 'cancel_timer', 'cancel_timer', 'settle']);
    expect(stepsIn(lastEvents)).toContainEqual(expect.objectContaining(cancelled));
  });

  it('cancels every branch when its own timeout fires in the middle of them', () => {
    const run = drivenRun(forking(waitingAndAsking, '\n      timeout: { after: PT1S }'), { respond: () => 'never' });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408, instance: '/do/0/both' } });
    expect(stepsWith(run.events, 'cancelled').map(({ reference }) => reference)).toEqual([
      '/do/0/both/fork/branches/0/waiting',
      '/do/0/both/fork/branches/1/asking',
    ]);
    expect(outputKindsIn(run.events.slice(-1))).toEqual([
      'cancel_timer',
      'cancel_call',
      'cancel_timer',
      'cancel_timer',
      'settle',
    ]);
  });
});

describe('a competing fork', () => {
  it('takes the first branch to finish and cancels the others', () => {
    const document = competing([
      'slow: { call: notify, with: { to: ada } }',
      `quick: { wait: PT1S, output: { as: '\${ "quick" }' } }`,
    ]);
    const run = drivenRun(document, { respond: () => 'never' });

    expect(run.outcome).toEqual({ kind: 'completed', output: 'quick' });
    expect(outputKindsIn(run.events.slice(-1))).toEqual(['cancel_call', 'cancel_timer', 'cancel_timer', 'settle']);
  });

  it('ends the workflow when the winner ends it, and gives null when it has no branch', () => {
    const ending = competing(['stop: { set: { stopped: true }, then: end }'], reachedAfter);

    expect(drivenRun(ending).outcome).toEqual({ kind: 'completed', output: { stopped: true } });
    expect(drivenRun(competing([])).outcome).toEqual({ kind: 'completed', output: null });
  });
});

describe('a competing fork whose branches fail', () => {
  it('raises the first failure when every branch fails', () => {
    const document = competing([
      'first: { raise: { error: { type: https://example.com/first, status: 409 } } }',
      'second: { raise: { error: { type: https://example.com/second, status: 409 } } }',
    ]);

    expect(drivenRun(document).outcome).toMatchObject({ kind: 'raised', error: { type: 'https://example.com/first' } });
  });

  it('raises the failure that came first, not the branch that comes first', () => {
    const document = competing([
      'asking: { call: notify, with: { to: ada } }',
      'refusing: { raise: { error: { type: https://example.com/refused, status: 409 } } }',
    ]);

    expect(drivenRun(document, { respond: () => failing }).outcome).toEqual({
      kind: 'raised',
      error: { type: 'https://example.com/refused', status: 409, instance: '/do/0/race/fork/branches/1/refusing' },
    });
  });
});
