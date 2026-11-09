import { describe, expect, it } from 'vitest';

import { callErrorOf, errorAsJson, errorFromJson, errorType } from './raised-error.ts';
import { settlementOf } from './settlement.ts';

const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

const child = '4661c5f4-f2c0-548b-ad03-ee30974ca0ee';

describe('the error of a call that did not succeed', () => {
  it('is a runtime error, status 500, for a rejection whose reason it does not know', () => {
    expect(callErrorOf({ status: 'rejected', reason: 'teapot', detail: 'short and stout' }, site)).toEqual({
      type: errorType('runtime'),
      status: 500,
      title: 'The function notify did not go through',
      detail: 'short and stout',
      instance: '/do/0/ask',
      cause: { status: 'rejected', reason: 'teapot' },
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
      cause: { status: 'rejected', reason: 'unavailable', kind: 'tools_unfinished', because: 'server_failed' },
    });
    expect(
      callErrorOf({ status: 'rejected', reason: 'conflict', detail: 'Called', kind: 'tools_called' }, site),
    ).not.toHaveProperty('because');
  });
});

describe('the type of the error of a call rejected with a kind', () => {
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
        cause: { status: 'rejected', reason: 'conflict', kind: 'tools_called' },
      },
    ]);
  });
});

describe('the error of a call whose run was cancelled', () => {
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
      cause: { status: 'rejected', reason: 'cancelled', kind: 'deadline' },
    });
  });

  it('ends a workflow that does not catch it by its status, without the kind, since the workflow itself was not cancelled', () => {
    const error = callErrorOf({ status: 'rejected', reason: 'cancelled', detail: 'Out', kind: 'parent_ended' }, site);
    const overran = callErrorOf({ status: 'rejected', reason: 'cancelled', detail: 'Out', kind: 'overrun' }, site);

    expect(settlementOf({ kind: 'raised', error })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The function notify was cancelled, at the step ask: Out.',
      cause: { step: 'do/0/ask', status: 'rejected', reason: 'cancelled', kind: 'parent_ended' },
    });
    expect(settlementOf({ kind: 'raised', error: overran })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The function notify was cancelled, at the step ask: Out.',
      cause: { step: 'do/0/ask', status: 'rejected', reason: 'cancelled', kind: 'overrun' },
    });
  });
});

describe('the error of a call whose request went unanswered', () => {
  const asking = { function: 'approve', label: 'the function approve', reference: '/do/0/ask' };
  const unansweredAs = (kind: string) =>
    callErrorOf({ status: 'rejected', reason: 'unanswered', detail: 'Nobody answered', kind }, asking);
  const expired = unansweredAs('expired');

  it('is of the type of an unanswered request, status 410, with its kind, which no retry of a communication error matches', () => {
    expect(expired).toEqual({
      type: 'https://on.auto/problems/unanswered',
      status: 410,
      title: 'The function approve went unanswered',
      detail: 'Nobody answered',
      instance: '/do/0/ask',
      kind: 'expired',
      cause: { status: 'rejected', reason: 'unanswered', kind: 'expired' },
    });
  });

  it('ends a workflow that does not catch it unanswered, with its kind, as the request it waited for ended', () => {
    expect([
      settlementOf({ kind: 'raised', error: expired }),
      settlementOf({ kind: 'raised', error: unansweredAs('undelivered') }),
      settlementOf({ kind: 'raised', error: unansweredAs('lapsed') }),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'unanswered',
        kind: 'expired',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
        cause: { step: 'do/0/ask', status: 'rejected', reason: 'unanswered', kind: 'expired' },
      },
      {
        status: 'rejected',
        reason: 'unanswered',
        kind: 'undelivered',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
        cause: { step: 'do/0/ask', status: 'rejected', reason: 'unanswered', kind: 'undelivered' },
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The function approve went unanswered, at the step ask: Nobody answered.',
      },
    ]);
  });
});

describe('the cause the error of a call to a workflow carries', () => {
  it('takes its codes from the rejection that ended that workflow, where its result names one, and its own otherwise', () => {
    const stopped = { status: 'rejected', reason: 'invalid_input', detail: 'Stopped' } as const;
    const paused = { step: 'do/0/hold-seats', status: 'rejected', reason: 'conflict', kind: 'paused' } as const;

    expect([
      callErrorOf({ ...stopped, cause: paused }, { ...site, child }).cause,
      callErrorOf({ ...stopped, cause: { step: 'do/0/hold-seats', status: 'timed_out' } }, { ...site, child }).cause,
      callErrorOf({ ...stopped, cause: { step: 'do/0/hold-seats', status: 'rejected', kind: 'paused' } }, site).cause,
    ]).toEqual([
      { status: 'rejected', run_id: child, reason: 'conflict', kind: 'paused' },
      { status: 'rejected', run_id: child, reason: 'invalid_input' },
      { status: 'rejected', kind: 'paused' },
    ]);
  });

  it('settles a run it ended with this step and the run it started, and the codes of the rejection that ended that workflow', () => {
    const paused = { step: 'do/0/hold-seats', status: 'rejected', reason: 'conflict', kind: 'paused' } as const;
    const book = callErrorOf(
      { status: 'rejected', reason: 'invalid_input', detail: 'It stopped', cause: paused },
      { ...site, reference: '/do/0/book', child },
    );

    expect(settlementOf({ kind: 'raised', error: book })).toMatchObject({
      reason: 'invalid_input',
      cause: { step: 'do/0/book', run_id: child, status: 'rejected', reason: 'conflict', kind: 'paused' },
    });
  });
});

describe('the cause the error of a call carries', () => {
  it('is written with the error a catch reads and read back from an error a raise names, when it is well formed', () => {
    const written = errorAsJson(callErrorOf({ status: 'failed', detail: 'It broke' }, { ...site, child }));

    expect(written).toMatchObject({ cause: { status: 'failed', run_id: child } });
    expect(errorFromJson(written, '/do/1/raise')?.cause).toEqual({ status: 'failed', run_id: child });
    expect(errorFromJson({ ...written, cause: { status: 'lost' } }, '/do/1/raise')).not.toHaveProperty('cause');
    expect(errorFromJson({ ...written, cause: 'failed' }, '/do/1/raise')).not.toHaveProperty('cause');
  });
});
