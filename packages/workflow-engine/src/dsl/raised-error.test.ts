import { problemTypeOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { callErrorOf, errorAsJson, errorType, reasonOfStatus, settlementOf } from './raised-error.ts';

describe('the rejection of an uncaught error', () => {
  it.each([400, 401, 403, 404, 409, 422, 499])('is invalid_input for the client error %d, a final result', (status) => {
    expect(reasonOfStatus(status)).toBe('invalid_input');
  });

  it.each([408, 429, 500, 503, 302, 0])('is unavailable for %d, which retrying may get past', (status) => {
    expect(reasonOfStatus(status)).toBe('unavailable');
  });
});

describe('the rejection of an uncaught error of a kind with a type of its own', () => {
  it('takes the reason of its kind, with its kind and because, so its words never say its input can be corrected', () => {
    const called = callErrorOf(
      { status: 'rejected', reason: 'conflict', detail: 'Called before', kind: 'tools_called' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );
    const unfinished = callErrorOf(
      { status: 'rejected', reason: 'unavailable', detail: 'Stopped', kind: 'tools_unfinished', because: 'run_bound' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect([
      settlementOf({ kind: 'raised', error: called }),
      settlementOf({ kind: 'raised', error: unfinished }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The function notify could not go through, at the step ask: Called before.',
        kind: 'tools_called',
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        detail: 'The function notify was not available, at the step ask: Stopped.',
        kind: 'tools_unfinished',
        because: 'run_bound',
      },
    ]);
    expect(settlementOf({ kind: 'raised', error: { ...called, type: errorType('runtime') } })).toMatchObject({
      reason: 'invalid_input',
    });
  });
});

describe('the rejection of an uncaught error whose effect is unknown', () => {
  it('settles effect_unknown as a conflict with its because, raised at 409 under its own type', () => {
    const unknown = callErrorOf(
      { status: 'rejected', reason: 'conflict', detail: 'Called', kind: 'effect_unknown', because: 'tool_error' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect(unknown).toMatchObject({ type: 'https://on.auto/problems/effect_unknown', status: 409 });
    expect([
      settlementOf({ kind: 'raised', error: unknown }),
      settlementOf({ kind: 'raised', error: { ...unknown, because: 'not a because' } }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The function notify could not go through, at the step ask: Called.',
        kind: 'effect_unknown',
        because: 'tool_error',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The function notify could not go through, at the step ask: Called.',
        kind: 'effect_unknown',
      },
    ]);
  });
});

describe('the error of a call that did not succeed', () => {
  const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

  it('is a runtime error, status 500, for a rejection whose reason it does not know', () => {
    expect(callErrorOf({ status: 'rejected', reason: 'teapot', detail: 'short and stout' }, site)).toEqual({
      type: errorType('runtime'),
      status: 500,
      title: 'The function notify did not go through',
      detail: 'short and stout',
      instance: '/do/0/ask',
    });
  });

  it('carries the kind and because of a rejection, which a document reads in the error it catches', () => {
    const rejected = {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'A tool server kept failing',
      kind: 'tools_unfinished',
      because: 'server_failed',
    } as const;

    expect(errorAsJson(callErrorOf(rejected, site))).toEqual({
      type: 'https://on.auto/problems/tools_unfinished',
      status: 503,
      title: 'The function notify was not available',
      detail: 'A tool server kept failing',
      instance: '/do/0/ask',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
    expect(
      callErrorOf({ status: 'rejected', reason: 'conflict', detail: 'Called', kind: 'tools_called' }, site),
    ).not.toHaveProperty('because');
  });
});

describe('the type of the error of a call rejected with a kind', () => {
  const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

  it('is of the type of its own a kind has, never a communication error, and of the type of its reason for any other kind', () => {
    const unavailable = { status: 'rejected', reason: 'unavailable', detail: 'No' } as const;

    expect([
      callErrorOf({ ...unavailable, kind: 'tools_unfinished' }, site).type,
      callErrorOf({ ...unavailable, kind: 'tool_server_failed' }, site).type,
      callErrorOf({ status: 'rejected', reason: 'conflict', detail: 'No', kind: 'tools_called' }, site),
    ]).toEqual([
      'https://on.auto/problems/tools_unfinished',
      errorType('communication'),
      {
        type: 'https://on.auto/problems/tools_called',
        status: 409,
        title: 'The function notify could not go through',
        detail: 'No',
        instance: '/do/0/ask',
        kind: 'tools_called',
      },
    ]);
  });
});

describe('the error of a call whose run was cancelled', () => {
  const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

  it('is of the type of a cancellation, status 409, with its kind, which no retry of a communication error matches', () => {
    expect(
      callErrorOf({ status: 'rejected', reason: 'cancelled', detail: 'Out of time', kind: 'deadline' }, site),
    ).toEqual({
      type: 'https://on.auto/problems/cancelled',
      status: 409,
      title: 'The function notify was cancelled',
      detail: 'Out of time',
      instance: '/do/0/ask',
      kind: 'deadline',
    });
  });

  it('ends a workflow that does not catch it by its status, without the kind, since the workflow itself was not cancelled', () => {
    const error = callErrorOf({ status: 'rejected', reason: 'cancelled', detail: 'Out', kind: 'parent_ended' }, site);

    expect(settlementOf({ kind: 'raised', error })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The function notify was cancelled, at the step ask: Out.',
    });
    expect(settlementOf({ kind: 'raised', error: { ...error, kind: 'overrun' } })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The function notify was cancelled, at the step ask: Out.',
    });
  });
});

describe('the error of a call whose request went unanswered', () => {
  const site = { function: 'approve', label: 'the function approve', reference: '/do/0/ask' };
  const expired = callErrorOf(
    { status: 'rejected', reason: 'unanswered', detail: 'Nobody answered', kind: 'expired' },
    site,
  );

  it('is of the type of an unanswered request, status 410, with its kind, which no retry of a communication error matches', () => {
    expect(expired).toEqual({
      type: 'https://on.auto/problems/unanswered',
      status: 410,
      title: 'The function approve went unanswered',
      detail: 'Nobody answered',
      instance: '/do/0/ask',
      kind: 'expired',
    });
  });

  it('ends a workflow that does not catch it unanswered, with its kind, as the request it waited for ended', () => {
    expect([
      settlementOf({ kind: 'raised', error: expired }),
      settlementOf({ kind: 'raised', error: { ...expired, kind: 'undelivered' } }),
      settlementOf({ kind: 'raised', error: { ...expired, kind: 'lapsed' } }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'unanswered',
        kind: 'expired',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
      },
      {
        status: 'rejected',
        reason: 'unanswered',
        kind: 'undelivered',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
      },
    ]);
  });
});

function raisedWith(kind: string, because: string) {
  return {
    kind: 'raised' as const,
    error: { type: errorType('runtime'), status: 503, instance: '/', title: 'No', kind, because },
  };
}

describe('the settlement of a workflow that ended otherwise', () => {
  it('keeps no kind or because of a step whose words hold for that step alone', () => {
    expect([
      settlementOf(raisedWith('rebuilding', 'run_bound')),
      settlementOf(raisedWith('taken', 'nothing_known')),
      settlementOf({
        kind: 'raised',
        error: { type: errorType('runtime'), status: 409, instance: '/', kind: 'stalled' },
      }),
      settlementOf({
        kind: 'raised',
        error: {
          type: problemTypeOf('cursor_not_held'),
          status: 422,
          instance: '/',
          title: 'No',
          kind: 'cursor_not_held',
        },
      }),
    ]).toEqual([
      { status: 'rejected', reason: 'unavailable', detail: 'No.' },
      { status: 'rejected', reason: 'unavailable', detail: 'No.' },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'https://open-workflow-specification.org/spec/1.0.0/errors/runtime.',
      },
      { status: 'rejected', reason: 'invalid_input', detail: 'No.', kind: 'cursor_not_held' },
    ]);
  });
});

describe('the settlement of a workflow whose output or run broke', () => {
  it('is a conflict of the kind oversized for an output larger than a run records, and a failure for a broken run', () => {
    expect([
      settlementOf({ kind: 'oversized', bytes: 1_048_575, most: 1_048_574 }),
      settlementOf({ kind: 'broken', reason: 'A step could not be read' }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'oversized',
        detail: 'The output of the workflow takes 1048575 bytes as JSON, more than the 1048574 a run records',
      },
      { status: 'failed' },
    ]);
  });

  it('keeps no because of a kind of a type of its own that names none', () => {
    const rebuilding = callErrorOf(
      { status: 'rejected', reason: 'unavailable', detail: 'Still building', kind: 'rebuilding' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect(settlementOf({ kind: 'raised', error: rebuilding })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The function notify was not available, at the step ask: Still building.',
      kind: 'rebuilding',
    });
  });

  it('takes a conflict from a step only with a kind of a type of its own', () => {
    const conflict = callErrorOf(
      { status: 'rejected', reason: 'conflict', detail: 'Too much', kind: 'oversized' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect(settlementOf({ kind: 'raised', error: conflict })).toMatchObject({ reason: 'invalid_input' });
  });
});
