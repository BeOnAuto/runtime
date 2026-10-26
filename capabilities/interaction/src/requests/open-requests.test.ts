import type { Context, ProjectedRow, RunContext } from '@on.auto/operations';
import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const messageId = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

const at = '2026-10-07T09:00:00.000Z';

const ofTheRun: RunContext = {
  by: 'playbook:alpha',
  at,
  runId: 'r-approve',
  definitionType: 'interaction',
  definitionName: 'approve-brief',
  definitionVersion: 1,
};

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

function after(row: ProjectedRow | undefined, { type, data }: Fact, context: Context = ofTheRun) {
  return openRequests.rowAfter(row, { id: messageId, position: 2, type, data, context });
}

const deliver = { server: 'chat', tool: 'post_message', with: { text: '{{ message }}' } };

const replies = {
  tool: 'thread_replies',
  with: { ts: '{{ sent.id }}' },
  read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
};

const request = {
  to: 'ada',
  message: 'Approve?',
  answer_schema: {},
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: at,
  deliver,
};

const build = { ...Struct.omit(request, ['deliver']), build: { brief_sha256: 'c'.repeat(64) } };

function deferralOf(record: object): Fact {
  return { type: 'run_deferred', data: { record } };
}

const open = after(undefined, deferralOf(request));

const failedRun: Fact = { type: 'run_failed', data: {} };

describe('the open request of a run', () => {
  it('is made by the deferral of a run whose record is a request, whatever the type of its function, which it keeps', () => {
    expect([
      open,
      after(undefined, deferralOf(build), { ...ofTheRun, definitionType: 'prediction', definitionName: 'demand' }),
      after(undefined, deferralOf({ run: 'x' })),
      after(undefined, deferralOf({ run: 'x' }), { ...ofTheRun, definitionType: 'workflow' }),
    ]).toEqual([
      {
        request_id: messageId,
        type: 'interaction',
        function: 'approve-brief',
        version: 1,
        party: 'ada',
        delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }),
        replies: null,
        message: 'Approve?',
        answers: true,
        answer_schema: '{}',
        requested_at: Date.parse(at),
        expires_at: Date.parse(request.expires_at),
        attempts: 0,
        next_attempt_at: Date.parse(at),
        standing: 'to_deliver',
        open: true,
        attempt_due_at: Date.parse(at),
        ending_due_at: Date.parse(request.expires_at),
        ended: null,
        conversation: null,
        sent_conversation: null,
        sent_id: null,
        answerer: null,
        reply: null,
        reply_refusals: 0,
        refusals_told: 0,
      },
      expect.objectContaining({
        type: 'prediction',
        function: 'demand',
        delivery: null,
        standing: 'in_inbox',
        answers: true,
        ending_due_at: Date.parse(request.expires_at),
      }),
      undefined,
      undefined,
    ]);
  });
});

describe('the open request of a run whose request carries blocks the interaction does not read', () => {
  it('is kept in the playbook’s shape, its blocks as written, waiting in the inbox until it expires', () => {
    const elsewhere = {
      ...Struct.omit(request, ['deliver']),
      deliver: { through: 'carrier-pigeon' },
      replies: { by: 'post' },
      reply: { kind: 'yes_or_no' },
    };

    expect(
      after(undefined, deferralOf(elsewhere), { ...ofTheRun, definitionType: 'prediction', definitionName: 'demand' }),
    ).toMatchObject({
      type: 'prediction',
      delivery: null,
      replies: JSON.stringify({ by: 'post' }),
      reply: JSON.stringify({ kind: 'yes_or_no' }),
      standing: 'in_inbox',
      open: true,
      attempt_due_at: null,
      ending_due_at: Date.parse(request.expires_at),
    });
  });
});

describe('the open request of a run, as its request recorded it', () => {
  it('keeps the tool it delivers through and how it reads replies as JSON text, and neither in the inbox', () => {
    const inbox = Struct.omit(request, ['deliver']);

    expect([after(undefined, deferralOf({ ...request, replies })), after(undefined, deferralOf(inbox))]).toMatchObject([
      { delivery: JSON.stringify({ server: 'chat', tool: 'post_message' }), replies: JSON.stringify(replies) },
      { delivery: null, replies: null, standing: 'in_inbox', attempt_due_at: null },
    ]);
  });

  it('keeps the answer schema its request recorded as JSON text, and none for a notification', () => {
    const answerSchema = { type: 'object', required: ['choice'], properties: { choice: { type: 'string' } } };
    const notification = Struct.omit(request, ['answer_schema']);

    expect([
      after(undefined, deferralOf({ ...request, answer_schema: answerSchema })),
      after(undefined, deferralOf(notification)),
    ]).toMatchObject([
      { answers: true, answer_schema: JSON.stringify(answerSchema) },
      { answers: false, answer_schema: null },
    ]);
  });
});

describe('the open request of a run that ends', () => {
  it('closes with the ending of its run, in the words of that ending, and changes no more after', () => {
    const cancelled = after(open, {
      type: 'run_rejected',
      data: { rejection: { reason: 'cancelled', kind: 'requested', detail: 'Off' } },
    });

    expect([cancelled, after(open, failedRun), after(cancelled, failedRun)]).toMatchObject([
      { open: false, attempt_due_at: null, ending_due_at: null, ended: 'cancelled' },
      { open: false, ended: 'failed' },
      undefined,
    ]);
  });

  it('is unchanged by a fact it does not keep, by what does not read as a fact, and by facts of a run without one', () => {
    const toolCall = {
      type: 'tool_call_started',
      data: {
        number: 1,
        call_id: 'c1',
        server: 'graph',
        tool: 'search',
        arguments_bytes: 2,
        arguments_sha256: 'a'.repeat(64),
      },
    };

    expect([after(open, toolCall), after(open, { type: 'nonsense', data: {} }), after(undefined, failedRun)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

const cancelAsked: Fact = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Off' } };

const attempt: Fact = {
  type: 'delivery_started',
  data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
};

const answerOfTheTool = { result_bytes: 2, result_sha256: 'b'.repeat(64), jsonrpc_id: 1 };

const delivered: Fact = { type: 'delivery_succeeded', data: { number: 1, ...answerOfTheTool, duration_ms: 40 } };

const taken: Fact = {
  type: 'request_answered',
  data: {
    answer: { choice: 'approve' },
    reply: { id: '1699.2', sender: 'ada' },
    answered_by: { id: 'playbook:alpha', name: 'alpha' },
  },
};

describe('the open request of a run asked to cancel', () => {
  it('stands cancelling and falls due no more, whatever its attempt in flight does', () => {
    const delivering = after(open, attempt);
    const cancelling = after(delivering, cancelAsked);
    const afterTheAttempt = after(cancelling, delivered);
    const failedAfter = after(cancelling, {
      type: 'delivery_failed',
      data: { number: 1, because: 'server_failure', duration_ms: 40 },
    });
    const takenAfter = after(cancelling, taken);

    expect([cancelling, afterTheAttempt, failedAfter, takenAfter]).toMatchObject([
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, open: true },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null, attempts: 1 },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
      { standing: 'cancelling', attempt_due_at: null, ending_due_at: null },
    ]);
    expect(after(after(cancelling, attempt), cancelAsked)).toMatchObject({ standing: 'cancelling' });
  });
});

describe('the open request of a run that took an answer', () => {
  it('stands answered and closes on the answer, due at once to settle, and a cancel or an attempt ending after leaves it so', () => {
    const answered = after(open, taken);
    const deliveredAfter = after(after(after(open, attempt), taken), delivered);

    expect([answered, after(answered, cancelAsked), deliveredAfter]).toMatchObject([
      { standing: 'answered', open: false, ended: null, ending_due_at: Date.parse(at), attempt_due_at: null },
      undefined,
      { standing: 'answered', open: false, ending_due_at: Date.parse(at), attempt_due_at: null },
    ]);
  });

  it('closes on the ending its run settles with, and of a function the playbook does not settle from its answer, waits for its run', () => {
    const ofABuild = { ...ofTheRun, definitionType: 'prediction' };
    const answeredBuild = after(after(undefined, deferralOf(request), ofABuild), taken, ofABuild);

    expect([
      after(after(open, taken), { type: 'run_succeeded', data: { output: { choice: 'approve' }, record: {} } }),
      answeredBuild,
    ]).toMatchObject([
      { standing: 'answered', open: false, ended: 'answered', ending_due_at: null },
      { standing: 'answered', open: false, ended: null, ending_due_at: null, attempt_due_at: null },
    ]);
  });

  it('of a notification of another function, delivered or not, waits for its run to settle it until it expires', () => {
    const ofABuild = { ...ofTheRun, definitionType: 'prediction' };
    const notification = after(undefined, deferralOf(Struct.omit(request, ['answer_schema'])), ofABuild);
    const deliveredOne = after(after(notification, attempt, ofABuild), delivered, ofABuild);
    const undelivered = after(
      after(notification, attempt, ofABuild),
      { type: 'delivery_refused', data: { number: 1, because: 'unworkable', duration_ms: 3 } },
      ofABuild,
    );

    expect([deliveredOne, undelivered]).toMatchObject([
      { standing: 'delivered', open: true, ending_due_at: Date.parse(request.expires_at) },
      { standing: 'undelivered', open: true, ending_due_at: Date.parse(request.expires_at) },
    ]);
  });

  it('is left alone once its run has ended, and by a fact another capability declares', () => {
    expect([
      after(after(open, failedRun), cancelAsked),
      after(open, { type: 'nudge_sent', data: { number: 1 } }),
    ]).toEqual([undefined, undefined]);
  });
});
