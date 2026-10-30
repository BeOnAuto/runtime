import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

describe('tasks a document reached the machine with, malformed', () => {
  it('raise a configuration error for a raise of no definition', async () => {
    expect((await interpret(workflow('do:\n  - reject: { raise: 3 }'))).settlement).toMatchObject({
      detail: 'raise names no error with a type and a status, at the step reject.',
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
      detail: 'for.in must give an array to iterate over, at the step loop.',
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
