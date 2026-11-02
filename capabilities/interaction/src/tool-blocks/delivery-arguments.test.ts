import { standingRenderClock } from '@on.auto/definitions/testing';
import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveryVariablesOf } from './delivery-arguments.ts';

const record = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

describe('the arguments of a delivery', () => {
  it('are rendered over the request, its moment, its run and its function, the schema null for a notification', () => {
    const variables = deliveryVariablesOf(record, { input: { a: 1 }, runId: 'run-1', functionName: 'approve' });

    expect(variables).toEqual({
      input: { a: 1 },
      today: '2026-10-07',
      now: '2026-10-07T09:00:00.000Z',
      to: 'ada',
      message: 'Approve?',
      run_id: 'run-1',
      function: 'approve',
      expires_at: '2026-10-09T09:00:00.000Z',
      answer_schema: null,
    });
    expect(renderedArguments({ text: '{{ to }}: {{ message }}' }, variables, standingRenderClock)).toEqual(
      Result.succeed({ input: { text: 'ada: Approve?' }, bytes: 24 }),
    );
  });

  it('read the answer schema of a request that takes an answer', () => {
    const schema = { type: 'object', properties: { choice: { enum: ['approve', 'reject'] } } };
    const variables = deliveryVariablesOf(
      { ...record, answer_schema: schema },
      { input: {}, runId: 'run-1', functionName: 'approve' },
    );

    expect(renderedArguments({ schema: '{{ answer_schema }}' }, variables, standingRenderClock)).toEqual(
      Result.succeed({ input: { schema }, bytes: 82 }),
    );
  });
});
