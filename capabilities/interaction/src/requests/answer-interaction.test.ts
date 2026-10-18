import { deferredCanceller } from '@on.auto/definitions';
import { Effect, Schema, SchemaTransformation } from 'effect';
import { describe, expect, it } from 'vitest';

import { answeringAnyRun } from '../testing/harness-parts.ts';
import {
  acmeAdmin,
  approvalDocument,
  askedRunId,
  askedThroughChat,
  datedAnswerSchema,
  interactionHarness,
  notificationDocument,
  recordedReply,
  takenReply,
} from '../testing/index.ts';
import { answerIssuesOf } from './answer-check.ts';
import { listInteractions } from './list-interactions.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const answer = answeringAnyRun;

const someText: unknown = expect.any(String);

const pastTheBound: unknown = expect.stringContaining('65536');

const outputOf = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.JsonObject }).pipe(
    Schema.decodeTo(
      Schema.JsonObject,
      SchemaTransformation.transform({
        decode: ({ output }) => output,
        encode: (output) => ({ status: 'succeeded' as const, output }),
      }),
    ),
  ),
);

const interaction = {
  run_id: runId,
  type: 'interaction',
  function: 'approve-brief',
  version: 1,
  to: 'ada',
  delivery: null,
  message: 'Approve?',
  takes_answer: true,
  answer_schema: { type: 'object' },
  requested_at: '2026-10-07T09:00:00.000Z',
  expires_at: '2026-10-09T09:00:00.000Z',
  attempts: 0,
  conversation: null,
  answerer: null,
  reply_refusals: 0,
  standing: 'in_inbox',
};

const refused = { ...interaction, conversation: 'C0123/1699.1', answerer: 'U024BE7LH', reply_refusals: 2 };

async function askedApproval(document = approvalDocument()) {
  const playbook = interactionHarness();
  await playbook.define('approve-brief', document);
  const asked = await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { playbook, asked };
}

describe('a request asked through the inbox', () => {
  it('waits as a started run, listed among the open requests of the playbook', async () => {
    const { playbook, asked } = await askedApproval();

    expect(asked).toMatchObject({ status: 'succeeded', output: { run_id: runId, status: 'started' } });
    expect(await playbook.call(listInteractions, {})).toMatchObject({
      status: 'succeeded',
      output: {
        interactions: [
          {
            run_id: runId,
            function: 'approve-brief',
            version: 1,
            to: 'ada',
            delivery: null,
            message: 'Please review the brief for Spring.',
            takes_answer: true,
            attempts: 0,
            standing: 'in_inbox',
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('an answer to a request', () => {
  it('is recorded on the run with who answered and the claim, and the run takes it at the next due work', async () => {
    const { playbook } = await askedApproval();

    const answered = await playbook.call(answer, {
      run_id: runId,
      answer: { choice: 'approve' },
      claimed_for: 'ada',
    });
    const before = await playbook.runOf(runId);
    const listed = await playbook.call(listInteractions, {});
    await playbook.performDue(Date.now());

    expect(answered).toEqual({
      status: 'succeeded',
      output: {
        run_id: runId,
        answer_id: someText,
        answer: { choice: 'approve' },
        claimed_for: 'ada',
        answered_by: acmeAdmin.id,
        answered_at: someText,
      },
    });
    expect([before, listed]).toMatchObject([{ output: { status: 'started' } }, { output: { interactions: [] } }]);
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: {} },
    });
  });
});

describe('an answer to a request that took one', () => {
  it('answers the answer the run took for the same answer again, and is a conflict for another one', async () => {
    const { playbook } = await askedApproval();
    const first = await playbook.call(answer, { run_id: runId, answer: { choice: 'approve' } });
    await playbook.performDue(Date.now());

    expect([
      await playbook.call(answer, { run_id: runId, answer: { choice: 'approve' }, claimed_for: 'ada' }),
      await playbook.call(answer, { run_id: runId, answer: { choice: 'reject' } }),
    ]).toMatchObject([
      first,
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run already took another answer, and a run takes one answer, so it takes no other',
      },
    ]);
  });
});

describe('an answer to a request a reply answered first', () => {
  it('answers the answer the reply brought when it is the same, with the reply that brought it', async () => {
    const { playbook } = await askedThroughChat();
    await recordedReply(playbook.ledger, { choice: 'approve' });

    expect(await playbook.call(answer, { run_id: askedRunId, answer: { choice: 'approve' } })).toMatchObject({
      status: 'succeeded',
      output: { answer: { choice: 'approve' }, reply: takenReply, answered_by: 'playbook:alpha' },
    });
  });
});

describe('an answer the request does not take', () => {
  it('is invalid input when it does not match the answer schema, with pointers, and leaves the request open', async () => {
    const { playbook } = await askedApproval(approvalDocument([], 'P2D', datedAnswerSchema));

    expect(await playbook.call(answer, { run_id: runId, answer: { choice: 'maybe', due: 'Friday' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'choice: expected one of: approve, reject. due: expected a date such as 2026-04-01.',
      issues: [{ pointer: '/answer/choice' }, { pointer: '/answer/due' }],
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({
      output: { interactions: [{ run_id: runId }] },
    });
  });

  it('is refused for a run there is not, a run that asks nothing, and a notification', async () => {
    const playbook = interactionHarness();
    await playbook.define('tell', notificationDocument());
    await playbook.ask('tell', { campaign: 'Spring', owner: 'ada' }, otherRunId);

    expect([
      await playbook.call(answer, { run_id: runId, answer: {} }),
      await playbook.call(answer, { run_id: otherRunId, answer: {} }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run is not a request of a function that waits for an answer',
      },
    ]);
  });
});

describe('an answer that is refused before it is checked', () => {
  it('is a conflict for a notification that waits for its delivery', async () => {
    const { playbook } = await askedThroughChat({ notification: true });

    expect(await playbook.call(answer, { run_id: askedRunId, answer: {} })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The request is a notification, which takes no answer',
    });
  });

  it('is invalid input past 64 KiB, and the answer schema of a request that cannot be read is no answer', async () => {
    const { playbook } = await askedApproval();

    expect([
      await playbook.call(answer, { run_id: runId, answer: { choice: 'approve', note: 'x'.repeat(70_000) } }),
      answerIssuesOf({}, { type: 'thing' }),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: pastTheBound,
        issues: [{ pointer: '/answer', detail: pastTheBound }],
      },
      [{ pointer: '/answer', detail: 'The answer schema of the request cannot be read.' }],
    ]);
  });
});

describe('the words of answers and requests', () => {
  it('is told in plain words, as the requests are', async () => {
    const { playbook } = await askedApproval();
    const answered = outputOf(await playbook.call(answer, { run_id: runId, answer: { choice: 'approve' } }));
    const listing = outputOf(await playbook.call(listInteractions, {}));
    const input = { run_id: runId, answer: { choice: 'approve' } };

    expect([
      answer.registration.plainLanguage?.attempt(input),
      answer.registration.plainLanguage?.outcome(answered, input),
      listInteractions.registration.plainLanguage?.attempt({}),
      listInteractions.registration.plainLanguage?.outcome(listing, {}),
      listInteractions.registration.plainLanguage?.outcome(
        { interactions: [interaction], has_more: false, next_cursor: null },
        {},
      ),
      listInteractions.registration.plainLanguage?.outcome(
        { interactions: [interaction, refused], has_more: false, next_cursor: null },
        {},
      ),
      listInteractions.registration.plainLanguage?.outcome(
        { interactions: [refused, refused], has_more: false, next_cursor: null },
        {},
      ),
    ]).toEqual([
      'answer the request',
      "The request is answered: the run that asked it takes the answer within the host's sweep, a second by default, and get_run shows how it ended.",
      'list the open requests',
      'No request is waiting.',
      'Found 1 request waiting on this page.',
      'Found 2 requests waiting on this page. One of them has had a reply refused.',
      'Found 2 requests waiting on this page. 2 of them have had a reply refused.',
    ]);
  });
});

describe('a request whose run is cancelled', () => {
  it('ends rejected as cancelled with the kind asked, closes, and takes no answer after', async () => {
    const { playbook } = await askedApproval();

    expect(await playbook.cancel(runId)).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    await Effect.runPromise(
      deferredCanceller([playbook.capability], playbook.ledger.service)(
        { org: 'acme', playbook: 'alpha', id: runId },
        { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        { causationId: null, correlationId: runId },
      ),
    );

    expect(await playbook.runOf(runId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed any more' },
      },
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
    expect(await playbook.call(answer, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      reason: 'conflict',
    });
  });
});

describe('an answer to a request whose run has a cancel asked', () => {
  it('is a conflict before the run ends, and the run stays started', async () => {
    const { playbook } = await askedApproval();
    await playbook.cancel(runId);

    expect(await playbook.call(answer, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'A cancel of the run was asked before it took an answer, so it takes none',
    });
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });
});
