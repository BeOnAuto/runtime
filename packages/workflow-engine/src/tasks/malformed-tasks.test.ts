import { describe, expect, it } from 'vitest';

import type { RunOutcome } from '../machine/run-state.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

function delivering(event: { readonly id: string; readonly type: string; readonly data?: number }) {
  return (driver: MemoryDriver, runId: string): void => {
    driver.at(1, () => {
      driver.deliver(runId, event);
    });
  };
}

describe('tasks a document reached the machine with, malformed', () => {
  it('raise a configuration error for a task of no type the machine knows', () => {
    expect(drivenRun(workflow('do:\n  - odd: { nothing: 1 }')).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'The task has no type this runtime knows' },
    });
  });

  it.each([
    ['a raise of no definition', 'do:\n  - reject: { raise: 3 }'],
    ['a raise of no error', 'do:\n  - reject: { raise: {} }'],
    ['a raise of an error the document does not name', 'do:\n  - reject: { raise: { error: missing } }'],
    ['a raise of an error with no integer status', 'do:\n  - reject: { raise: { error: { type: x, status: 4.5 } } }'],
  ])('raise a configuration error for %s', (_what, source) => {
    expect(drivenRun(workflow(source)).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'raise names no error with a type and a status' },
    });
  });
});

describe('flow tasks a document reached the machine with, malformed', () => {
  it('catch every error in a try of no catch', () => {
    const document = workflow('do:\n  - guarded: { try: [{ fail: { raise: { error: { type: x, status: 400 } } } }] }');

    expect(drivenRun(document, { input: 1 }).outcome).toEqual({ kind: 'completed', output: 1 });
  });

  it('continue past a switch of no cases, and over cases that are not cases', () => {
    const document = workflow(`
do:
  - empty: { switch: 3 }
  - odd: { switch: [3, { odd: 3 }, { fine: { then: continue } }] }
  - after: { set: { after: true } }
`);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: { after: true } });
  });

  it('raise a validation error for a for of no definition, and fork nothing for a fork of none', () => {
    expect(drivenRun(workflow('do:\n  - loop: { for: 3, do: [] }')).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'for.in must give an array to iterate over' },
    });
    expect(drivenRun(workflow('do:\n  - none: { fork: 3 }')).outcome).toEqual({ kind: 'completed', output: [] });
  });
});

describe('listen tasks a document reached the machine with, malformed', () => {
  it('wait for a listen of no filter until a timeout', () => {
    const document = workflow('do:\n  - deaf: { listen: 3, timeout: { after: PT1S } }');

    expect(drivenRun(document).outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
  });

  it.each(['3', '{}'])('take any event when a listen filter is %s', (filter) => {
    const document = workflow(`do:\n  - any: { listen: { to: { one: ${filter} } } }`);

    expect(drivenRun(document, { meanwhile: delivering({ id: 'e', type: 'anything', data: 1 }) }).outcome).toEqual({
      kind: 'completed',
      output: [1],
    });
  });

  it('match a property an event does not have as null', () => {
    const document = workflow('do:\n  - any: { listen: { to: { one: { with: { data: null } } } } }');

    expect(drivenRun(document, { meanwhile: delivering({ id: 'e', type: 'anything' }) }).outcome).toEqual({
      kind: 'completed',
      output: [null],
    });
  });
});

describe('other tasks a document reached the machine with, malformed', () => {
  it('call with null arguments when a call gives none', () => {
    const document = workflow('do:\n  - ask: { call: notify }');
    const run = drivenRun(document, {
      respond: (call) => ({ result: { status: 'succeeded', output: call.arguments } }),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: null });
  });

  it('raise a configuration error for a timeout of no duration', () => {
    const document = workflow('do:\n  - pause: { wait: PT1S, timeout: {} }');

    expect(titleOf(drivenRun(document).outcome)).toMatch(/^A duration of the task is not valid: /u);
  });

  it('let a task with a timeout raise its own error', () => {
    const document = workflow(
      'do:\n  - reject: { raise: { error: { type: x, status: 400 } }, timeout: { after: PT1S } }',
    );

    expect(drivenRun(document).outcome).toMatchObject({
      kind: 'raised',
      error: { type: 'x', instance: '/do/0/reject' },
    });
  });

  it('retry with no limit until the run is stopped', () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ fail: { raise: { error: { type: x, status: 503 } } } }]
      catch: { retry: { delay: PT1S } }
`);

    expect(drivenRun(document, { limits: { mostDurationMs: 4500 } }).outcome).toEqual({
      kind: 'overran',
      milliseconds: 4500,
    });
  });
});

describe('templates of a task', () => {
  it('evaluate the expressions in lists, and loop over null items and items held twice', () => {
    const document = workflow(`
do:
  - listed: { set: ['\${ $data.a }', 2] }
  - loop:
      for: { in: '\${ [null, $data[0], $data[0]] }' }
      do: [{ seen: { set: { item: '\${ $item }' } } }]
`);

    expect(drivenRun(document, { input: { a: { b: 1 } } }).outcome).toEqual({
      kind: 'completed',
      output: { item: { b: 1 } },
    });
  });
});
