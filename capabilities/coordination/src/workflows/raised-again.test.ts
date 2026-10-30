import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import { testWorkflowPolicy } from '../testing/test-sandbox.ts';
import { interpret, workflow } from '../testing/workflows.ts';

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
      detail:
        'https://example.com/errors/seats-refused, at the step report: seats, How many seats to hold: expected at least 1.',
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
      detail: 'https://on.auto/problems/tools_unfinished, at the step report: A tool server kept failing.',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
  });
});
