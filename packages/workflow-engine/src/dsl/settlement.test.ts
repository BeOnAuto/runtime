import { problemTypeOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { callErrorOf, errorType } from './raised-error.ts';
import { reasonOfStatus, settlementOf } from './settlement.ts';

const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

const child = '4661c5f4-f2c0-548b-ad03-ee30974ca0ee';

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
        cause: { step: 'do/0/ask', status: 'rejected', reason: 'conflict', kind: 'tools_called' },
      },
      {
        status: 'rejected',
        reason: 'unavailable',
        detail: 'The function notify was not available, at the step ask: Stopped.',
        kind: 'tools_unfinished',
        because: 'run_bound',
        cause: {
          step: 'do/0/ask',
          status: 'rejected',
          reason: 'unavailable',
          kind: 'tools_unfinished',
          because: 'run_bound',
        },
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
        cause: {
          step: 'do/0/ask',
          status: 'rejected',
          reason: 'conflict',
          kind: 'effect_unknown',
          because: 'tool_error',
        },
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The function notify could not go through, at the step ask: Called.',
        kind: 'effect_unknown',
        cause: {
          step: 'do/0/ask',
          status: 'rejected',
          reason: 'conflict',
          kind: 'effect_unknown',
          because: 'tool_error',
        },
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
      settlementOf(raisedWith('tool_server_failed', 'unreachable')),
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
    const unfinished = callErrorOf(
      { status: 'rejected', reason: 'unavailable', detail: 'Stopped', kind: 'tools_unfinished' },
      { function: 'notify', label: 'the function notify', reference: '/do/0/ask' },
    );

    expect(settlementOf({ kind: 'raised', error: unfinished })).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The function notify was not available, at the step ask: Stopped.',
      kind: 'tools_unfinished',
      cause: { step: 'do/0/ask', status: 'rejected', reason: 'unavailable', kind: 'tools_unfinished' },
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

describe('the cause of a rejection, the step whose work ended the run', () => {
  it('names the step, the run its call started and the rejection of that run, so a paused function is said to be paused', () => {
    const paused = callErrorOf(
      { status: 'rejected', reason: 'conflict', detail: 'It is paused', kind: 'paused' },
      { ...site, reference: '/do/1/qualify', child },
    );

    expect(paused.cause).toEqual({ status: 'rejected', run_id: child, reason: 'conflict', kind: 'paused' });
    expect(settlementOf({ kind: 'raised', error: paused })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The function notify could not go through, at the step qualify: It is paused.',
      cause: { step: 'do/1/qualify', run_id: child, status: 'rejected', reason: 'conflict', kind: 'paused' },
    });
  });

  it('says a call failed, could not be reached or timed out, with the run it started and no codes', () => {
    const failed = callErrorOf({ status: 'failed', detail: 'It broke' }, { ...site, child });
    const unreachable = callErrorOf({ status: 'unreachable', detail: 'Gone' }, site);
    const timedOut = {
      type: errorType('timeout'),
      status: 408,
      instance: '/do/0/ask',
      kind: 'ignored',
      because: 'ignored',
      cause: { status: 'timed_out' as const, run_id: child },
    };

    expect([
      settlementOf({ kind: 'raised', error: failed }),
      settlementOf({ kind: 'raised', error: unreachable }),
      settlementOf({ kind: 'raised', error: timedOut }),
    ]).toEqual([
      expect.objectContaining({ cause: { step: 'do/0/ask', run_id: child, status: 'failed' } }),
      expect.objectContaining({ cause: { step: 'do/0/ask', status: 'unreachable' } }),
      expect.objectContaining({ cause: { step: 'do/0/ask', run_id: child, status: 'timed_out' } }),
    ]);
  });
});

describe('the codes of the cause of a rejection', () => {
  const broken = callErrorOf(
    {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'Broken',
      kind: 'tool_not_offered',
      because: 'connection_broken',
    },
    { ...site, child },
  );

  it('keep a because of the one vocabulary, as a connection that is broken says', () => {
    expect(settlementOf({ kind: 'raised', error: broken })).toMatchObject({
      reason: 'unavailable',
      cause: {
        step: 'do/0/ask',
        run_id: child,
        status: 'rejected',
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'connection_broken',
      },
    });
  });

  it('leave the cause out whole when any of them is outside the vocabulary, as the result of a call may give', () => {
    expect(
      settlementOf({
        kind: 'raised',
        error: { ...broken, cause: { status: 'rejected', reason: 'unavailable', kind: 'not_a_kind' } },
      }),
    ).not.toHaveProperty('cause');
    expect(
      settlementOf({ kind: 'raised', error: { ...broken, cause: { status: 'rejected', reason: 'teapot' } } }),
    ).not.toHaveProperty('cause');
  });
});

describe('the codes a cause names itself', () => {
  it('are read from the cause alone, not the error, so a cause that names a kind without a reason keeps it, which a call never leaves out', () => {
    const raised = {
      type: errorType('runtime'),
      status: 409,
      instance: '/do/0/ask',
      kind: 'stalled',
      cause: { status: 'rejected' as const, kind: 'paused' },
    };

    expect(settlementOf({ kind: 'raised', error: raised })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: `${errorType('runtime')}, at the step ask.`,
      cause: { step: 'do/0/ask', status: 'rejected', kind: 'paused' },
    });
  });
});

describe('a rejection with no cause', () => {
  it('is the settlement of an error that names no step, or no cause', () => {
    const ofTheWholeWorkflow = callErrorOf({ status: 'failed', detail: 'It broke' }, { ...site, reference: '/' });
    const raised = { type: errorType('runtime'), status: 500, instance: '/do/0/ask', title: 'No' };

    expect(settlementOf({ kind: 'raised', error: ofTheWholeWorkflow })).not.toHaveProperty('cause');
    expect(settlementOf({ kind: 'raised', error: raised })).not.toHaveProperty('cause');
  });
});
