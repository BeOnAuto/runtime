import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import { testWorkflowPolicy } from '../testing/test-sandbox.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const anyWords: unknown = expect.any(String);

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: again
  version: '1.0.0'
`;

const raisingAgain = `use:
  errors:
    unfinished: { type: https://on.auto/problems/tools_unfinished, status: 503, kind: tools_unfinished }
do:
  - lookup:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        as: failure
        do:
          - report:
              raise:
                error:
                  type: '\${ $failure.type }'
                  status: 503
                  detail: '\${ $failure.detail }'
                  kind: '\${ $failure.kind }'
                  because: '\${ $failure.because }'
`;

const raisingTheRefusal = `do:
  - book:
      try:
        - hold:
            call: run_definition
            with: { type: computation, name: hold-seats, input: { seats: 0 } }
      catch:
        as: refusal
        do:
          - report:
              raise:
                error:
                  type: https://example.com/errors/seats-refused
                  status: 400
                  detail: '\${ $refusal.detail }'
                  issues: '\${ $refusal.issues }'
`;

const refusedSeats = [{ pointer: '/input/seats', detail: 'seats, How many seats to hold: expected at least 1.' }];

describe('a refused input raised again from the error a workflow caught', () => {
  it('keeps the issues of the refusal, which the run is rejected with', async () => {
    const { settlement } = await interpret(workflow(raisingTheRefusal), {
      respond: () => ({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'seats, How many seats to hold: expected at least 1.',
        issues: refusedSeats,
      }),
    });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: anyWords,
      issues: refusedSeats,
    });
  });
});

describe('an error raised again from the one a workflow caught', () => {
  it('may name its kind and because, in a raise or under use.errors, which the DSL takes', async () => {
    const parsed = await Effect.runPromise(
      Effect.result(parseWorkflowDocument(`${header}${raisingAgain}`, testWorkflowPolicy)),
    );

    expect(Result.isSuccess(parsed)).toBe(true);
  });

  it('is still refused when it is not an error at all', async () => {
    const parsed = await Effect.runPromise(
      Effect.result(
        parseWorkflowDocument(
          `${header}use:\n  errors:\n    busy: oops\ndo:\n  - fail: { raise: { error: busy } }\n`,
          testWorkflowPolicy,
        ),
      ),
    );

    expect(Result.isFailure(parsed)).toBe(true);
  });

  it('keeps its kind and because, so the run ends as the function it called did', async () => {
    const { settlement } = await interpret(workflow(raisingAgain), {
      respond: () => ({
        status: 'rejected',
        reason: 'unavailable',
        detail: 'A tool server kept failing',
        kind: 'tools_unfinished',
        because: 'server_failed',
      }),
    });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: anyWords,
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
  });
});

const racing = workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - slow:
              do:
                - pause: { wait: PT10S }
                - mark: { set: { winner: slow } }
          - fast:
              wait: PT1S
          - failing:
              raise:
                error: { type: https://example.com/broken, status: 500 }
  - after:
      set: { finished: '\${ $data }' }
`);

describe('a fork', () => {
  it('runs its branches at once and outputs their outputs in order', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - left:
              wait: PT2S
          - right:
              set: { side: right }
`);

    const { ending, fake } = await interpret(document, { input: { side: 'left' } });

    expect(ending).toEqual({ kind: 'completed', output: [{ side: 'left' }, { side: 'right' }] });
    expect(fake.now() - Date.parse('2026-10-01T09:00:00.000Z')).toBe(2000);
  });

  it('outputs an empty list when it has no branches', async () => {
    expect((await interpret(workflow('do:\n  - none: { fork: { branches: [] } }'))).ending).toEqual({
      kind: 'completed',
      output: [],
    });
  });
});

describe('a fork whose branches compete', () => {
  it('outputs the first branch to succeed and cancels the others', async () => {
    const { ending, commands } = await interpret(racing, { input: { winner: 'fast' } });

    expect(ending).toEqual({ kind: 'completed', output: { finished: { winner: 'fast' } } });
    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/race/fork/branches/0/slow/do/0/pause' });
  });

  it('outputs null when it has no branches', async () => {
    expect((await interpret(workflow('do:\n  - none: { fork: { compete: true, branches: [] } }'))).ending).toEqual({
      kind: 'completed',
      output: null,
    });
  });

  it('raises the first error when every branch fails', async () => {
    const document = workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - first: { raise: { error: { type: https://example.com/first, status: 503 } } }
          - second: { raise: { error: { type: https://example.com/second, status: 503 } } }
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'https://example.com/first, at the step first.',
    });
  });
});

const failingAtOnce = workflow(`
do:
  - both:
      fork:
        branches:
          - waiting: { wait: PT1H }
          - failing: { raise: { error: { type: https://example.com/broken, status: 400 } } }
`);

describe('a fork whose branch fails', () => {
  it('raises the error', async () => {
    expect((await interpret(failingAtOnce)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'https://example.com/broken, at the step failing.',
    });
  });

  it('ends the workflow when a branch ends it', async () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - stopping: { set: { stopped: true }, then: end }
          - going: { set: { going: true } }
  - after:
      set: { after: true }
`);

    expect((await interpret(document)).ending).toEqual({
      kind: 'completed',
      output: [{ stopped: true }, { going: true }],
    });
  });
});
