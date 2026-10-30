import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { workflow } from '../testing/workflows.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

function pointersRejectedIn(tasks: string): readonly string[] {
  return rejectionsOf(workflow(`do:\n${tasks}`)).map(({ pointer }) => pointer);
}

describe('the durations and errors of tasks', () => {
  it('are checked in raise and wait, and an expression is left to the check at save', () => {
    expect(
      pointersRejectedIn(`
  - missing: { raise: { error: nowhere } }
  - computed: { raise: { error: { type: '\${ $data.type }', status: 400 } } }
  - pause: { wait: soon }
  - later: { wait: '\${ $data.wait }' }
  - fixed: { set: [1, { a: '\${ $data.a }' }] }
`),
    ).toEqual(['/do/0/missing/raise/error', '/do/2/pause/wait']);
  });
});

describe('the names a for and a catch bind', () => {
  it('are identifiers, none of them a name the runtime gives every expression', () => {
    expect(
      pointersRejectedIn(`
  - each: { for: { in: $data.items, each: line, at: place }, do: [] }
  - spaced: { for: { in: $data.items, each: a line, at: 3 }, do: [] }
  - taken: { for: { in: $data.items, each: context, at: data }, do: [] }
  - caught: { try: [], catch: { as: problem } }
  - shadowing: { try: [], catch: { as: workflow } }
  - odd: { try: [], catch: { as: 'not-an-identifier' } }
`),
    ).toEqual([
      '/do/1/spaced/for/each',
      '/do/1/spaced/for/at',
      '/do/2/taken/for/each',
      '/do/2/taken/for/at',
      '/do/4/shadowing/catch/as',
      '/do/5/odd/catch/as',
    ]);
  });
});

describe('the catch of a try', () => {
  it('is checked with its retry policy', () => {
    expect(
      pointersRejectedIn(`
  - guarded:
      try: []
      catch:
        when: $data.a
        exceptWhen: $data.b
        retry: { delay: soon, limit: { duration: P1M, attempt: { duration: never } }, exceptWhen: $data.c }
  - reused: { try: [], catch: { retry: nowhere } }
  - shaped: { try: [], catch: { retry: 3 } }
`),
    ).toEqual([
      '/do/0/guarded/catch/retry/delay',
      '/do/0/guarded/catch/retry/limit/duration',
      '/do/0/guarded/catch/retry/limit/attempt/duration',
      '/do/1/reused/catch/retry',
    ]);
  });

  it('may reuse a retry policy', () => {
    expect(
      rejectionsOf(
        workflow(`
use:
  retries:
    patient: { delay: PT1S }
do:
  - guarded: { try: [], catch: { retry: patient } }
`),
      ),
    ).toEqual([]);
  });
});

describe('the parts every task has', () => {
  it('are checked: schemas and timeout', () => {
    expect(
      pointersRejectedIn(`
  - shaped:
      if: $data.a
      input: { from: $data.b, schema: { document: {} } }
      output: { as: { c: '\${ $data.c }' } }
      export: { as: $data.d, schema: { document: {} } }
      timeout: { after: never }
      set: {}
  - limited: { set: {}, timeout: nowhere }
`),
    ).toEqual([
      '/do/0/shaped/input/schema',
      '/do/0/shaped/export/schema',
      '/do/0/shaped/timeout/after',
      '/do/1/limited/timeout',
    ]);
  });
});

describe('tasks whose parts are not what the DSL says', () => {
  it('are read without breaking', () => {
    expect(
      pointersRejectedIn(`
  - fork: { fork: 3 }
  - loop: { for: 3, do: [] }
  - guarded: { try: [], catch: 3 }
  - deaf: { listen: 3 }
  - unheard: { listen: { to: { all: 3 } } }
  - silent: { raise: 3 }
  - route: { switch: 3 }
  - cases: { switch: [{ odd: 3 }] }
`),
    ).toEqual([]);
  });

  it('reject a call of no name', () => {
    expect(pointersRejectedIn('  - nameless: { call: 3 }')).toEqual(['/do/0/nameless/call']);
  });
});

describe('the flow of tasks', () => {
  it('lets a task jump to a task of its own list only', () => {
    expect(
      pointersRejectedIn(`
  - first: { set: {}, then: third }
  - second: { set: {}, then: exit }
  - third: { set: {}, then: nowhere }
`),
    ).toEqual(['/do/2/third/then']);
  });

  it('checks the lists nested in do, for, try, catch and fork', () => {
    expect(
      pointersRejectedIn(`
  - block: { do: [{ inner: { run: {} } }] }
  - loop: { for: { in: $data.items }, do: [{ inner: { emit: {} } }] }
  - guarded: { try: [{ inner: { run: {} } }], catch: { do: [{ handler: { run: {} } }] } }
  - parallel:
      fork:
        branches:
          - left: { run: {} }
          - right: { set: {}, then: left }
          - done: { set: {}, then: end }
`),
    ).toEqual([
      '/do/0/block/do/0/inner/run',
      '/do/1/loop/do/0/inner/emit',
      '/do/2/guarded/try/0/inner/run',
      '/do/2/guarded/catch/do/0/handler/run',
      '/do/3/parallel/fork/branches/0/left/run',
      '/do/3/parallel/fork/branches/1/right/then',
    ]);
  });
});
