import { mostStepsWithoutWaiting } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { testWorkflowPolicy as workflowPolicy } from '../testing/test-sandbox.ts';
import { interpret, outputsAtTimeZero, runId, workflow } from '../testing/workflows.ts';

const anyWords: unknown = expect.any(String);

const closing = workflow(`
schedule:
  on: { one: { with: { type: com.example.ledger.closed } } }
  every: PT1H
input:
  from: '\${ Array.isArray($data) ? { month: $data[0].data.month } : { due: $data.schedule.due } }'
do:
  - keep: { set: '\${ $data }' }
`);

describe('a workflow with an event trigger and a schedule', () => {
  it('tells the input of a run its event started from the input of a run its schedule started', async () => {
    const event = {
      specversion: '1.0',
      id: 'e1',
      source: '/ledger',
      type: 'com.example.ledger.closed',
      data: { month: 'september' },
    };

    const runs = [
      await interpret(closing, { input: [event] }),
      await interpret(closing, { input: { schedule: { due: '2026-10-01T10:00:00.000Z' } } }),
    ];

    expect(runs.map(({ ending }) => ending)).toEqual([
      { kind: 'completed', output: { month: 'september' } },
      { kind: 'completed', output: { due: '2026-10-01T10:00:00.000Z' } },
    ]);
  });
});

describe('a workflow that never waits', () => {
  it('is stopped once it has run too many tasks without waiting', () => {
    const document = workflow(`
do:
  - spin:
      set: { turn: 1 }
      then: spin
`);

    expect(outputsAtTimeZero(document).at(-1)).toEqual({
      kind: 'settle',
      runId,
      settlement: {
        status: 'rejected',
        reason: 'unavailable',
        detail: `The workflow ran ${mostStepsWithoutWaiting} tasks without waiting for anything; it would never end, at the step spin.`,
      },
    });
  });

  it('may run many tasks as long as it waits in between', async () => {
    const document = workflow(`
do:
  - spin:
      for: { in: '\${ [0, 1, 2] }' }
      do:
        - count: { set: { turns: '\${ ($data.turns ?? 0) + 1 }' } }
        - rest: { wait: PT1S }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { turns: 3 } });
  });
});

function emitting(attributes: string) {
  return workflow(`
do:
  - announce: { emit: { event: { with: ${attributes} } } }
`);
}

describe('a workflow that emits an event', () => {
  it('hands the event to its playbook with an id the runtime gives it, and goes on', async () => {
    const document = emitting("{ type: com.acme.closed, source: /acme/ledger, data: { month: '${ $data.month }' } }");

    const { ending, commands } = await interpret(document, { input: { month: 'september' } });

    expect(ending).toEqual({ kind: 'completed', output: { month: 'september' } });
    expect(commands.filter(({ kind }) => kind === 'emitted')).toMatchObject([
      {
        kind: 'emitted',
        event: { specversion: '1.0', type: 'com.acme.closed', source: '/acme/ledger', data: { month: 'september' } },
      },
    ]);
  });

  it('is refused when it is saved with a type or a source the playbook records itself', () => {
    const document = emitting('{ type: run_succeeded, source: /runs/0199a3c4 }');

    expect(workflowPolicy(document).map(({ pointer }) => pointer)).toEqual([
      '/do/0/announce/emit/event/with/type',
      '/do/0/announce/emit/event/with/source',
    ]);
  });

  it('fails when the event it computes is not one the playbook takes', async () => {
    const { ending } = await interpret(emitting(`{ type: com.acme.closed, source: '\${ "/callers/someone" }' }`));

    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message: anyWords,
    });
  });
});

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
      detail: anyWords,
    });
  });
});

describe('tasks a document reached the machine with, malformed', () => {
  it('raise a configuration error for a raise of no definition', async () => {
    expect((await interpret(workflow('do:\n  - reject: { raise: 3 }'))).settlement).toMatchObject({
      detail: anyWords,
    });
  });

  it('catch every error in a try of no catch', async () => {
    const document = workflow('do:\n  - guarded: { try: [{ fail: { raise: { error: { type: x, status: 400 } } } }] }');

    expect((await interpret(document, { input: 1 })).ending).toEqual({ kind: 'completed', output: 1 });
  });

  it('continue past a switch of no cases, and over cases that are not cases', async () => {
    const document = workflow(`
do:
  - empty: { switch: 3 }
  - odd: { switch: [3, { fine: { then: continue } }] }
  - after: { set: { after: true } }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { after: true } });
  });

  it('raise a validation error for a for of no definition, and fork nothing for a fork of none', async () => {
    const looping = workflow('do:\n  - loop: { for: 3, do: [] }');
    const forking = workflow('do:\n  - none: { fork: 3 }');

    expect((await interpret(looping)).settlement).toMatchObject({
      detail: anyWords,
    });
    expect((await interpret(forking)).ending).toEqual({ kind: 'completed', output: [] });
  });

  it('wait forever for a listen of no filter, until a timeout', async () => {
    const document = workflow(
      'do:\n  - deaf: { listen: 3, timeout: { after: PT1S } }\n  - odd: { listen: { to: { one: 3 } } }',
    );

    expect((await interpret(document)).settlement).toMatchObject({
      detail: 'The task did not finish within 1000 ms, at the step deaf.',
    });
  });
});

describe('a listen whose filter is not an object', () => {
  it.each(['3', '{}'])('takes any event when the filter is %s', async (filter) => {
    const document = workflow(`do:\n  - any: { listen: { to: { one: ${filter} } } }`);

    const { ending } = await interpret(document, {
      started: (start) => {
        start.deliver({ id: 'e', type: 'anything', data: 1 });
      },
    });

    expect(ending).toEqual({ kind: 'completed', output: [1] });
  });
});

describe('templates of a task', () => {
  it('evaluate the expressions in lists, and loop over null items', async () => {
    const document = workflow(`
do:
  - listed: { set: ['\${ $data.a }', 2] }
  - loop:
      for: { in: '\${ [null] }' }
      do: [{ seen: { set: { item: '\${ $item }' } } }]
`);

    expect((await interpret(document, { input: { a: 1 } })).ending).toEqual({
      kind: 'completed',
      output: { item: null },
    });
  });

  it('let a task with a timeout raise its own error', async () => {
    const document = workflow(
      'do:\n  - reject: { raise: { error: { type: x, status: 400 } }, timeout: { after: PT1S } }',
    );

    expect((await interpret(document)).settlement).toMatchObject({ detail: 'x, at the step reject.' });
  });
});
