import { IssueSchema, type Issue } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionCallResult } from '../testing/run-terms.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const booking = workflow(`
do:
  - hold-seats:
      call: run_definition
      with: { type: computation, name: seat-hold, input: '\${ $data }' }
`);

const travelling = workflow(`
do:
  - book:
      call: run_definition
      with: { type: workflow, name: booking, input: '\${ $data }' }
`);

const refusedSeats: readonly Issue[] = [
  { pointer: '/input/seats', detail: 'seats, How many seats to hold: expected at least 1.' },
  { pointer: '/input/day', detail: 'day: expected a date.' },
];

function refusing(issues: readonly Issue[]): () => DefinitionCallResult {
  return () => ({
    status: 'rejected',
    reason: 'invalid_input',
    detail: issues.map(({ detail }) => detail).join(' '),
    issues,
  });
}

const refusalOf = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('rejected'),
    reason: Schema.Literal('invalid_input'),
    detail: Schema.String,
    issues: Schema.Array(IssueSchema),
  }),
);

describe('a workflow whose step refused its input', () => {
  it('is rejected with the function and the step first, then a sentence for each issue, and the issues', async () => {
    const { settlement } = await interpret(booking, { respond: refusing(refusedSeats), input: { seats: 0, day: 5 } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The computation function seat-hold refused its input, at the step hold-seats: seats, How many seats to hold: expected at least 1. day: expected a date.',
      issues: refusedSeats,
    });
  });
});

describe('a workflow that called a workflow whose step refused its input', () => {
  it('says the workflow stopped at its own step, then the refusal of the step inside it, with the innermost issues', async () => {
    const inner = await interpret(booking, { respond: refusing(refusedSeats.slice(0, 1)) });
    const innerRefusal = refusalOf(inner.settlement);
    const { settlement } = await interpret(travelling, { respond: () => innerRefusal });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The workflow booking stopped, at the step book: The computation function seat-hold refused its input, at the step hold-seats: seats, How many seats to hold: expected at least 1.',
      issues: refusedSeats.slice(0, 1),
    });
  });
});
