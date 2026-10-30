import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

const types = 'https://open-workflow-specification.org/spec/1.0.0/errors';

describe('raise', () => {
  it('raises the error it defines, with expressions evaluated', async () => {
    const document = workflow(`
do:
  - reject:
      raise:
        error:
          type: https://example.com/errors/limit
          status: 422
          title: Over the limit
          detail: '\${ \`The total \${$data.total} is over 100\` }'
          instance: /orders
`);

    expect((await interpret(document, { input: { total: 120 } })).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'Over the limit, at /orders: The total 120 is over 100.',
    });
  });

  it('raises an error the document defines once under use.errors', async () => {
    const document = workflow(`
use:
  errors:
    busy: { type: https://example.com/errors/busy, status: 503 }
do:
  - reject:
      raise: { error: busy }
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'https://example.com/errors/busy, at the step reject.',
    });
  });

  it('raises a configuration error when it names no error with a type and a status', async () => {
    const missing = workflow('do:\n  - reject: { raise: { error: nowhere } }');
    const shapeless = workflow('do:\n  - reject: { raise: { error: { type: x, status: "${ \\"500\\" }" } } }');

    expect((await interpret(missing)).settlement).toMatchObject({
      detail: 'raise names no error with a type and a status, at the step reject.',
    });
    expect((await interpret(shapeless)).settlement).toMatchObject({
      detail: 'raise names no error with a type and a status, at the step reject.',
    });
  });
});

describe('a try', () => {
  it('outputs the output of its tasks when none fails', async () => {
    const document = workflow('do:\n  - guarded: { try: [{ fine: { set: { fine: true } } }], catch: {} }');

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { fine: true } });
  });

  it('catches an error, runs catch.do with the error, and goes on', async () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/oops, status: 400, title: Oops } } }
      catch:
        as: problem
        do:
          - recover: { set: { recovered: '\${ $problem.title }', input: '\${ $data }' } }
  - after:
      set: { after: '\${ $data.recovered }' }
`);

    expect((await interpret(document, { input: 1 })).ending).toEqual({ kind: 'completed', output: { after: 'Oops' } });
  });

  it('swallows a caught error when it has no catch.do, and outputs its input', async () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ fail: { raise: { error: { type: https://example.com/oops, status: 400 } } } }]
      catch: {}
`);

    expect((await interpret(document, { input: { kept: true } })).ending).toEqual({
      kind: 'completed',
      output: { kept: true },
    });
  });
});

function filtered(filter: string) {
  return workflow(`
do:
  - guarded:
      try: [{ fail: { raise: { error: { type: https://example.com/oops, status: 409, detail: lost } } } }]
      catch:
        ${filter}
        do: [{ recover: { set: { caught: true } } }]
`);
}

describe('the filters of a catch', () => {
  it.each([
    'errors: { with: { status: 409 } }',
    'errors: { with: { type: https://example.com/oops, details: lost } }',
    'when: $error.status == 409',
    'exceptWhen: $error.status == 500',
  ])('catch with %s', async (filter) => {
    expect((await interpret(filtered(filter))).ending).toEqual({ kind: 'completed', output: { caught: true } });
  });

  it.each(['errors: { with: { status: 500 } }', 'when: $error.status == 500', 'exceptWhen: $error.status == 409'])(
    'let the error through with %s',
    async (filter) => {
      expect((await interpret(filtered(filter))).settlement).toMatchObject({
        status: 'rejected',
        reason: 'invalid_input',
      });
    },
  );
});

describe('a try that ends or exits', () => {
  it('ends the workflow when its tasks end it', async () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ stop: { set: { stopped: true }, then: end } }]
      catch: {}
  - after: { set: { after: true } }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { stopped: true } });
  });

  it('ends the workflow when its catch.do ends it', async () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ fail: { raise: { error: { type: https://example.com/oops, status: 400 } } } }]
      catch: { do: [{ stop: { set: { stopped: true }, then: end } }] }
  - after: { set: { after: true } }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { stopped: true } });
  });
});

describe('the errors of the runtime', () => {
  it('are errors the document can catch, of the standard types', async () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ broken: { set: '\${ $data.a.toFixed(1) }' } }]
      catch:
        do: [{ report: { set: '\${ $error }' } }]
`);

    expect((await interpret(document, { input: { a: 'text' } })).ending).toEqual({
      kind: 'completed',
      output: {
        type: `${types}/expression`,
        status: 400,
        instance: '/do/0/guarded/try/0/broken',
        title: 'An expression failed',
        detail: '$data.a.toFixed(1): TypeError: not a function',
      },
    });
  });
});
