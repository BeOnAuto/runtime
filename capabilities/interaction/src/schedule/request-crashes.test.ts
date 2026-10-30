import { memoryLedger } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  askedRunId,
  askedThroughChat,
  attemptedThenStopped,
  broughtBeforeDeciding,
  recordedReply,
} from '../testing/index.ts';

const days = 24 * 60 * 60_000;

const anyTime: unknown = expect.any(String);

const settledByThePlaybook = { record: {} };

describe('an answer a reply brought, whose settlement the server stopped before', () => {
  it('is settled from the reply after a restart, as the playbook, with no attempt made again', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    await playbook.performDue(askedAt);
    await recordedReply(playbook.ledger, { choice: 'approve' });

    const afterStop = await playbook.firstOpen();
    const performed = await playbook.performDue(Date.now());

    expect([afterStop, performed]).toEqual([undefined, 1]);
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { choice: 'approve' }, ...settledByThePlaybook },
    });
    expect(tools.calls()).toHaveLength(1);
  });

  it('is settled with the answer even when the restart comes after the request would have expired', async () => {
    const { playbook, askedAt } = await askedThroughChat();
    await recordedReply(playbook.ledger, { choice: 'reject' });

    await playbook.performDue(askedAt + 3 * days);

    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
  });
});

describe('a notification delivered, whose settlement the server stopped before', () => {
  it('succeeds from the ended delivery after a restart, and is not delivered again', async () => {
    const asked = await askedThroughChat({ notification: true });

    const stopped = await attemptedThenStopped(asked);
    const afterStop = await asked.playbook.firstOpen();
    await asked.playbook.performDue(Date.now());

    expect([stopped, afterStop]).toMatchObject([true, { attempts: 1, standing: 'delivered' }]);
    expect(await asked.playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
    expect(asked.tools.calls()).toHaveLength(1);
  });
});

describe('a due request, as the host sees it', () => {
  it('calls out for an attempt, and not for an expiry, a settlement or an attempt lost', async () => {
    const { playbook, askedAt } = await askedThroughChat();

    const toAttempt = await playbook.dueItems(askedAt);
    const toExpire = await playbook.dueItems(askedAt + 3 * days);

    expect([toAttempt.map(({ callsOut }) => callsOut), toExpire.map(({ callsOut }) => callsOut)]).toEqual([
      [true],
      [false],
    ]);
  });
});

describe('an answer a reply brought and another one given meanwhile', () => {
  it('keeps the answer of the reply, and refuses the other as a conflict', async () => {
    const { playbook } = await askedThroughChat();
    await recordedReply(playbook.ledger, { choice: 'approve' });

    const meanwhile = await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'reject' } });
    await playbook.performDue(Date.now());

    expect(meanwhile).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The run already took another answer, and a run takes one answer, so it takes no other',
    });
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, ...settledByThePlaybook },
    });
  });

  it('refuses the other when a reply is taken between the read of the request and the settlement', async () => {
    const racing = broughtBeforeDeciding(memoryLedger(undefined, [openRequests]), { choice: 'approve' });
    const asked = await askedThroughChat({ ledger: racing.ledger });
    await racing.started();

    const meanwhile = await asked.playbook.call(answerInteraction, {
      run_id: askedRunId,
      answer: { choice: 'reject' },
    });
    await asked.playbook.performDue(Date.now());

    expect(meanwhile).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(await asked.playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, ...settledByThePlaybook },
    });
  });
});
