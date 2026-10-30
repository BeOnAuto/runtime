import { cancelledUnanswered, type Work, type WorkRule } from '@on.auto/definitions';
import { Conflict } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { askedRunId, askedThroughChat, type InteractionHarness } from '../testing/index.ts';
import type { DeliveryEvent } from './run-facts.ts';
import { deliveryRule, interactionWorkOf, replyBounds, replyRule } from './work-rules.ts';

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

function recording(playbook: InteractionHarness) {
  return (work: Work, rule: WorkRule) =>
    Effect.runPromise(Effect.result(Effect.asVoid(playbook.record(address, work, lineage, rule))));
}

function delivering(playbook: InteractionHarness) {
  const recorded = recording(playbook);
  return (fact: DeliveryEvent) => recorded({ type: 'work', fact }, deliveryRule(fact));
}

function started(number: number): DeliveryEvent {
  return { type: 'delivery_started', data: { number, target: 'ada', server: 'chat', tool: 'post_message' } };
}

function failed(number: number): DeliveryEvent {
  return { type: 'delivery_failed', data: { number, because: 'server_failure', duration_ms: 40 } };
}

function notInFlight(number: number): Conflict {
  return new Conflict({
    detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
  });
}

describe('the delivery attempts of a request', () => {
  it('are recorded in order, each ended once while in flight, so an attempt two hosts make is recorded once', async () => {
    const { playbook } = await askedThroughChat();
    const deliver = delivering(playbook);

    expect([
      await deliver(started(1)),
      await deliver(started(1)),
      await deliver(failed(2)),
      await deliver(failed(1)),
      await deliver(failed(1)),
      await deliver(started(2)),
    ]).toEqual([
      Result.void,
      Result.fail(
        new Conflict({
          detail:
            'The run records its delivery attempts in order, and attempt 1 is not its next, 2; another attempt recorded it first',
        }),
      ),
      Result.fail(notInFlight(2)),
      Result.void,
      Result.fail(notInFlight(1)),
      Result.void,
    ]);
  });

  it('start no more once a cancel is asked or the request was answered, though the attempt in flight may still end', async () => {
    const cancelling = await askedThroughChat();
    const answered = await askedThroughChat();
    await delivering(cancelling.playbook)(started(1));
    await cancelling.playbook.cancel(askedRunId);
    await answered.playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    expect([
      await delivering(cancelling.playbook)(failed(1)),
      await delivering(cancelling.playbook)(started(2)),
      await delivering(answered.playbook)(started(1)),
    ]).toEqual([
      Result.void,
      Result.fail(new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' })),
      Result.fail(new Conflict({ detail: 'The request was answered, so it starts no more deliveries' })),
    ]);
  });
});

const ofTheReply = { server: 'chat', tool: 'thread_replies' };

function refusal(id: string): Work {
  return {
    type: 'work',
    fact: {
      type: 'reply_refused',
      data: { ...ofTheReply, reply: { id, sender: 'ada' }, because: 'invalid', told: false },
    },
  };
}

function taking(id: string): Work {
  return { type: 'answer', answer: { answer: { choice: 'approve' }, reply: { id, sender: 'ada' } } };
}

const replySeen = new Conflict({ detail: 'The run has taken or refused this reply already, so it records it once' });

describe('the replies a request takes or refuses', () => {
  it('are each recorded once, refused at most ten times, and none is taken or refused once the run took an answer', async () => {
    const { playbook } = await askedThroughChat();
    const record = recording(playbook);
    const refuse = (id: string) => record(refusal(id), replyRule(id, true));
    const refusals = await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: replyBounds.refusals }, (_, index) => `r-${index}`),
        (id) => Effect.promise(() => refuse(id)),
      ),
    );

    expect(refusals).toEqual(Array.from({ length: replyBounds.refusals }, () => Result.void));
    expect([
      await refuse('r-0'),
      await refuse('r-10'),
      await record(taking('r-11'), replyRule('r-11', false)),
      await record(taking('r-12'), replyRule('r-12', false)),
      await record(refusal('r-11'), replyRule('r-11', true)),
    ]).toEqual([
      Result.fail(replySeen),
      Result.fail(
        new Conflict({ detail: 'The run has refused 10 replies, the most it records, so it records no more' }),
      ),
      Result.void,
      Result.fail(new Conflict({ detail: 'The run took an answer already, so it takes no further reply' })),
      Result.fail(replySeen),
    ]);
  });

  it('take no answer once a cancel is asked, by the rule every answer meets, and record no refusal then', async () => {
    const { playbook } = await askedThroughChat();
    await playbook.cancel(askedRunId);
    const record = recording(playbook);

    expect([
      await record(taking('r-1'), replyRule('r-1', false)),
      await record(refusal('r-2'), replyRule('r-2', true)),
    ]).toEqual([
      Result.fail(cancelledUnanswered),
      Result.fail(
        new Conflict({
          detail: 'The run is being cancelled, so it records no refused reply and tells the party nothing',
        }),
      ),
    ]);
  });
});

describe('the work of a request as its capability reads it', () => {
  const at = '2026-10-07T09:00:00.000Z';

  const context = {
    at,
    by: 'playbook:alpha',
    runId: askedRunId,
    definitionType: 'interaction',
    definitionName: 'approval',
    definitionVersion: 1,
  };

  it('passes over the work another capability declares, and keeps when a delivery landed', () => {
    expect(
      interactionWorkOf([
        { type: 'nudge_sent', data: { number: 1 }, context },
        { type: 'delivery_started', data: started(1).data, context },
        {
          type: 'delivery_succeeded',
          data: { number: 1, result_bytes: 2, result_sha256: 'd'.repeat(64), duration_ms: 3, jsonrpc_id: 1 },
          context,
        },
      ]),
    ).toEqual({ lastAttempt: 1, inFlight: null, deliveredAt: at, refusedReplies: [] });
  });

  it('refuses work of its own in a shape no reader of it knows, as any unreadable fact of the run', () => {
    expect(() => interactionWorkOf([{ type: 'delivery_started', data: { number: 1 }, context }])).toThrow(
      'Missing key\n  at ["data"]["target"]',
    );
  });
});
