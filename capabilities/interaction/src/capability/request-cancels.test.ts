import { cancelledUnanswered, deferredCanceller } from '@on.auto/definitions';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { replyRule } from '../facts/work-rules.ts';
import { openRequests, openRequestsName } from '../requests/open-requests.ts';
import {
  alpha,
  askedRunId,
  askedThroughChat,
  broughtBeforeDeciding,
  recordedReply,
  takenReply,
  type InteractionHarness,
} from '../testing/index.ts';
import { cancelledRequest } from './request-cancels.ts';

const notification = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

const question = { ...notification, answer_schema: { type: 'object' } };

const at = '2026-10-07T09:00:00.000Z';

const anyTime: unknown = expect.any(String);

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

const asked = { run: address, kind: 'requested', reason: 'Not needed any more' } as const;

const cancelledAsAsked = { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: asked.reason };

const taken = { answer: 'yes', reply: takenReply, by: { id: 'playbook:alpha', name: 'alpha' }, at };

const delivered = {
  type: 'delivery_succeeded',
  data: { number: 1, result_bytes: 2, result_sha256: 'd'.repeat(64), duration_ms: 3, jsonrpc_id: 1 },
  at,
};

const answeredByThePlaybook = { status: 'succeeded', output: 'yes', record: {}, by: 'playbook:alpha' };

describe('the cancel of a request', () => {
  it('settles with the answer the run took, or as delivered for a notification, and else as asked', () => {
    expect([
      cancelledRequest({ ...asked, record: question, answer: taken, work: [delivered] }),
      cancelledRequest({ ...asked, record: notification, answer: null, work: [delivered] }),
      cancelledRequest({ ...asked, record: question, answer: null, work: [delivered] }),
      cancelledRequest({ ...asked, record: notification, answer: null, work: [] }),
      cancelledRequest({ ...asked, record: question, answer: null, work: [] }),
      cancelledRequest({ ...asked, record: { run: 'x' }, answer: taken, work: [delivered] }),
    ]).toEqual([
      answeredByThePlaybook,
      { status: 'succeeded', output: {}, record: { delivered_at: at } },
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
      cancelledAsAsked,
    ]);
  });
});

async function standingOf(playbook: InteractionHarness) {
  const [kept] = await Effect.runPromise(
    playbook.ledger.service.readProjectedRows(openRequestsName, alpha, {
      where: [{ column: 'row_key', equals: askedRunId }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  );
  return { open: kept?.row['open'], standing: kept?.row['standing'] };
}

describe('a cancel asked after a reply answered and before its run was settled', () => {
  it('leaves the request to settle with the answer, and settles it so itself, as whoever gave the answer', async () => {
    const { playbook } = await askedThroughChat();
    const lineage = { causationId: null, correlationId: askedRunId };
    await recordedReply(playbook.ledger, { choice: 'approve' });

    await playbook.cancel(askedRunId);
    const afterTheCancel = await standingOf(playbook);
    await Effect.runPromise(
      deferredCanceller([playbook.capability], playbook.ledger.service)(
        address,
        { ...asked, by: 'acme-admin' },
        lineage,
      ),
    );

    expect(afterTheCancel).toEqual({ open: false, standing: 'answered' });
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' }, record: {} },
    });
  });
});

describe('a cancel asked before a reply is read', () => {
  it('wins: the reply is not taken, and the run ends cancelled', async () => {
    const { playbook } = await askedThroughChat();
    const lineage = { causationId: null, correlationId: askedRunId };

    await playbook.cancel(askedRunId);
    const refused = await Effect.runPromise(
      Effect.flip(
        playbook.record(
          address,
          { type: 'answer', answer: { answer: { choice: 'approve' }, reply: takenReply } },
          lineage,
          replyRule(takenReply.id, false),
        ),
      ),
    );
    await Effect.runPromise(
      deferredCanceller([playbook.capability], playbook.ledger.service)(
        address,
        { ...asked, by: 'acme-admin' },
        lineage,
      ),
    );

    expect(refused).toEqual(cancelledUnanswered);
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } },
    });
  });
});

describe('a cancel whose notification is delivered between its read of the run and its settlement', () => {
  it('reads the run again, as it changed, and succeeds it as delivered', async () => {
    const racing = broughtBeforeDeciding(memoryLedger(undefined, [openRequests]));
    const delivering = await askedThroughChat({ notification: true, ledger: racing.ledger });
    await racing.started();

    await delivering.playbook.cancel(askedRunId);
    await racing.cancelSettled(delivering.playbook.capability);

    expect(await delivering.playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: {}, record: { delivered_at: anyTime } },
    });
  });
});
