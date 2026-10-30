import { runSettler } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DeliveryEvent } from '../facts/run-facts.ts';
import { answerInteraction } from '../requests/answer-interaction.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import {
  approvalDocument,
  askedRunId,
  askedThroughChat,
  chatDelivery,
  alpha,
  fakeTools,
  interactionHarness,
} from '../testing/index.ts';
import { recordedCall } from './request-ledger.ts';

const minute = 60_000;

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

const failing = { outcome: 'server_failure', detail: 'The tool server answered HTTP 503', retryAfterMs: null } as const;

const endsOfADelivery: ReadonlySet<string> = new Set(['delivery_succeeded', 'delivery_failed', 'delivery_refused']);

const answerAndEnds: ReadonlySet<string> = new Set(['request_answered', ...endsOfADelivery]);

describe('a notification whose attempts fail', () => {
  it('waits for the next attempt after one that failed, and ends undelivered once the fifth failed', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat({ notification: true });
    tools.answerNext(failing, failing, failing, failing, failing);

    await playbook.performDue(askedAt);
    const afterTheFirst = await playbook.runOf(askedRunId);
    await playbook.performEach([1, 2, 3, 4].map((step) => askedAt + step * 20 * minute));

    expect(afterTheFirst).toMatchObject({ output: { status: 'started' } });
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unanswered',
          kind: 'undelivered',
          detail:
            'The notification could not be delivered through the post message tool of chat, though every attempt was made',
        },
      },
    });
  });

  it('ends undelivered at the next perform when the server stopped before ending it', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat({ notification: true });
    const record = (fact: DeliveryEvent) => Effect.runPromise(recordedCall(playbook.record, address, fact, lineage));
    await record({
      type: 'delivery_started',
      data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
    });
    await record({ type: 'delivery_refused', data: { number: 1, because: 'too_large', duration_ms: 3 } });

    await playbook.performDue(askedAt);

    expect(tools.calls()).toEqual([]);
    expect(await playbook.runOf(askedRunId)).toMatchObject({ output: { rejection: { kind: 'undelivered' } } });
  });
});

describe('an expiry due behind attempts', () => {
  it('is read apart from the attempts due before it, as an item that calls out nowhere', async () => {
    const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';
    const { playbook, askedAt } = await askedThroughChat();
    await playbook.define('ask-in-inbox', approvalDocument([], 'PT1M'));
    await playbook.ask('ask-in-inbox', { campaign: 'Spring', owner: 'ada' }, otherRunId);
    const now = askedAt + 2 * minute;

    const attempts = await Effect.runPromise(playbook.due.due(now, 1, true));
    const endings = await Effect.runPromise(playbook.due.due(now, 1, false));

    expect([attempts, endings]).toMatchObject([
      [{ key: `acme/alpha/${askedRunId}`, callsOut: true }],
      [{ key: `acme/alpha/${otherRunId}`, callsOut: false }],
    ]);
    expect(await Effect.runPromise(playbook.due.nextDueAt(askedAt - minute))).toBeLessThanOrEqual(askedAt);
    expect(await Effect.runPromise(playbook.due.nextDueAt(askedAt + 3 * 24 * 60 * minute))).toBeNull();
  });

  it('is the next time of the endings alone, apart from the next attempt, when the lane is asked', async () => {
    const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';
    const { playbook } = await askedThroughChat();
    await playbook.define('ask-in-inbox', approvalDocument([], 'PT1M'));
    await playbook.ask('ask-in-inbox', { campaign: 'Spring', owner: 'ada' }, otherRunId);
    const rows = await Effect.runPromise(
      playbook.ledger.service.readProjectedRows(openRequestsName, alpha, {
        where: [],
        orderBy: [],
        order: 'asc',
        limit: 10,
      }),
    );
    const columnOf = (key: string, column: string) => rows.find((kept) => kept.key === key)?.row[column];
    const before = Number(columnOf(askedRunId, 'attempt_due_at')) - 1;

    const lanes = await Effect.runPromise(
      Effect.all([playbook.due.nextDueAt(before, true), playbook.due.nextDueAt(before, false)]),
    );

    expect(lanes).toEqual([columnOf(askedRunId, 'attempt_due_at'), columnOf(otherRunId, 'ending_due_at')]);
  });
});

describe('a due request performed out of turn', () => {
  it('does nothing when performed before it is due, and expires nothing once its run took an answer, which the run takes', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat({ expires: 'PT1H' });
    const attempt = await playbook.dueItems(askedAt);
    const expiry = await playbook.dueItems(askedAt + 2 * 60 * minute);
    await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    await playbook.performAll(attempt, askedAt - minute);
    await playbook.performAll(expiry, askedAt + 2 * 60 * minute);
    const afterTheExpiry = await playbook.runOf(askedRunId);
    await playbook.performDue(Date.now());

    expect(tools.calls()).toEqual([]);
    expect(afterTheExpiry).toMatchObject({ output: { status: 'started' } });
    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' } },
    });
  });

  it('records the end of an attempt that lands after its run took an answer, and the run takes that answer', async () => {
    const meanwhile = { answer: (): Promise<unknown> => Promise.resolve() };
    const tools = fakeTools(() => Effect.promise(() => meanwhile.answer()));
    const playbook = interactionHarness({ tools });
    meanwhile.answer = () => playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'reject' } });
    await playbook.define('approve-brief', approvalDocument(chatDelivery));
    await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);

    await playbook.performDue(Date.now());
    await playbook.performDue(Date.now());
    const { records } = await Effect.runPromise(
      playbook.ledger.service.readRecorded(address, { kind: 'run', run: askedRunId }, { order: 'asc', limit: 20 }),
    );

    expect(await playbook.runOf(askedRunId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'reject' } },
    });
    expect(records.map(({ type }) => type).filter((type) => answerAndEnds.has(type))).toEqual([
      'request_answered',
      'delivery_succeeded',
    ]);
  });
});

describe('an attempt that lands after its run ended', () => {
  it('records no end of the attempt, and changes nothing', async () => {
    const meanwhile = { end: (): Promise<unknown> => Promise.resolve() };
    const tools = fakeTools(() => Effect.promise(() => meanwhile.end()));
    const playbook = interactionHarness({ tools });
    meanwhile.end = () =>
      Effect.runPromise(
        Effect.result(
          runSettler(playbook.ledger.service)(address, {
            status: 'rejected',
            reason: 'cancelled',
            kind: 'requested',
            detail: 'Not needed any more',
          }),
        ),
      );
    await playbook.define('approve-brief', approvalDocument(chatDelivery));
    await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);

    await playbook.performDue(Date.now());
    const { records } = await Effect.runPromise(
      playbook.ledger.service.readRecorded(address, { kind: 'run', run: askedRunId }, { order: 'asc', limit: 20 }),
    );

    expect(await playbook.runOf(askedRunId)).toMatchObject({ output: { status: 'rejected' } });
    expect(records.map(({ type }) => type).filter((type) => answerAndEnds.has(type))).toEqual([]);
  });

  it('is not started when its run ended after the attempt fell due', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const attempt = await playbook.dueItems(askedAt);
    await Effect.runPromise(
      runSettler(playbook.ledger.service)(address, { status: 'succeeded', output: { choice: 'approve' } }),
    );

    await playbook.performAll(attempt, askedAt);

    expect(tools.calls()).toEqual([]);
  });
});
