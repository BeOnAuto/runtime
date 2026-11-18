import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { openRequests } from '../requests/open-requests.ts';
import {
  askedRunId,
  askedThroughChat,
  attemptedThenStopped,
  broughtBeforeDeciding,
  noTools,
  recordedReply,
  ledgerKeepingNames,
} from '../testing/index.ts';
import { requestsDue } from './due-requests.ts';
import { recordedCall } from './request-ledger.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

describe('an attempt the server stopped in', () => {
  it('ends as lost once its bound passed, and the next attempt follows on the schedule', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    await Effect.runPromise(
      recordedCall(
        playbook.record,
        address,
        { type: 'delivery_started', data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' } },
        { causationId: null, correlationId: askedRunId },
      ),
    );

    const whileInFlight = await playbook.performDue(askedAt + 30_000);
    await playbook.performDue(Date.now() + minute + 1000);
    const lost = await playbook.firstOpen();
    await playbook.performDue(Date.now() + 2 * minute + 2000);

    expect(whileInFlight).toBe(0);
    expect(lost).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(tools.calls()).toHaveLength(1);
    expect(await playbook.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });
});

describe('an attempt two hosts make at once', () => {
  it('is made by the host whose start is recorded first, and the other sends nothing', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);

    await playbook.performAll([...items, ...items], askedAt);

    expect(tools.calls()).toHaveLength(1);
  });
});

describe('a due request whose run has ended, or whose tool is no longer allowed', () => {
  it('sends nothing for a run answered since it was read as due', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);
    await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    await playbook.performAll(items, askedAt);

    expect(tools.calls()).toEqual([]);
  });

  it('fails each attempt as a tool no longer offered, and the request stays open, to be answered with answer_interaction', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    tools.disallow('post_message');

    await playbook.performDue(askedAt);
    const open = await playbook.firstOpen();
    const nextDue = await Effect.runPromise(playbook.due.nextDueAt(askedAt));
    const answered = await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    expect(tools.calls()).toEqual([]);
    expect(open).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(nextDue).toBeGreaterThan(askedAt + minute - 1000);
    expect(answered).toMatchObject({ status: 'succeeded', output: { answer: { choice: 'approve' } } });
  });
});

describe('a request whose tool server is gone since it asked', () => {
  it('fails its attempt as a tool no longer offered, and two hosts that try record the failure once', async () => {
    const { playbook, askedAt } = await askedThroughChat();
    const withoutServers = requestsDue({ ledger: playbook.ledger.service, tools: noTools, record: playbook.record });
    const items = await playbook.dueItems(askedAt, withoutServers);

    await playbook.performAll([...items, ...items], askedAt);

    expect(await playbook.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
  });
});

describe('a request whose run is asked to cancel', () => {
  it('sends nothing more, even for an attempt read as due before the cancel was asked', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);

    const asked = await playbook.cancel(askedRunId);
    await playbook.performAll(items, askedAt);
    const performed = await playbook.performDue(Date.now() + 10 * minute);

    expect([asked.status, performed, tools.calls()]).toEqual(['succeeded', 0, []]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'cancelling', attempts: 0 });
  });
});

const days = 24 * 60 * 60_000;

const anyTime: unknown = anyWords;

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
      detail: anyWords,
    });
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, ...settledByThePlaybook },
    });
  });

  it('refuses the other when a reply is taken between the read of the request and the settlement', async () => {
    const racing = broughtBeforeDeciding(ledgerKeepingNames([openRequests]), { choice: 'approve' });
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
