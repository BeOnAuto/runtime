import { defineGoOnWithRun } from '@on.auto/definitions';
import type { Lineage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { listInteractions } from '../requests/list-interactions.ts';
import { priya, priyasAgent, sam } from '../sign-in-testing/sign-in-runs.ts';
import { approvalAsked, approving } from '../testing/approving.ts';
import { interactionHarness } from '../testing/interaction-harness.ts';
import { runsGoingOn, type GoOn } from './runs-going-on.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const later = '2099-10-09T09:00:00.000Z';

const expiresAt = Date.parse(later);

async function askedToApprove(expiry = later) {
  const playbook = interactionHarness({ others: [approving] });
  await playbook.defineAs('approving', 'pay-supplier', expiry);
  await playbook.askAs('approving', 'pay-supplier', {}, runId);
  const wentOn: { readonly id: string; readonly lineage: Lineage }[] = [];
  const goOnWithRun = defineGoOnWithRun(playbook.capabilities);
  const goOn: GoOn = ({ id }, lineage) =>
    Effect.flatMap(
      Effect.promise(() => {
        wentOn.push({ id, lineage });
        return playbook.call(goOnWithRun, { run_id: id });
      }),
      (outcome) => (outcome.status === 'succeeded' ? Effect.void : Effect.fail(outcome)),
    );
  const going = runsGoingOn({ ledger: playbook.ledger.service, goOn });
  const goneOn = async (now: number) => {
    const items = await Effect.runPromise(going.due(now, 16, true));
    await Effect.runPromise(Effect.forEach(items, (item) => item.perform(now), { discard: true }));
    return items.length;
  };
  return { playbook, going, goneOn, wentOn };
}

function answer(approved: boolean) {
  return { run_id: runId, answer: { approved } };
}

describe('a request that asks a person to approve an action', () => {
  it('is listed with the action it asks them to approve, waiting on that person', async () => {
    const { playbook } = await askedToApprove();

    expect(await playbook.call(listInteractions, {})).toMatchObject({
      output: {
        interactions: [
          {
            run_id: runId,
            type: 'approving',
            to: approvalAsked.to,
            standing: 'held_for_an_agent',
            sign_in: null,
            approval: approvalAsked.approval,
          },
        ],
      },
    });
  });

  it('is answered by the person it asks alone, and approved from their own session alone', async () => {
    const asked = await askedToApprove();
    const declining = await askedToApprove();

    expect([
      await asked.playbook.call(answerInteraction, answer(true), sam),
      await asked.playbook.call(answerInteraction, answer(true), priyasAgent),
      await declining.playbook.call(answerInteraction, answer(false), priyasAgent),
      await asked.playbook.call(answerInteraction, answer(true), priya),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'This request asks person:user_7kLm2 to approve an action of shop, and an approval request is answered by the person it asks alone',
      },
      {
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'The person approves an action from their own session, in Studio, and never through an agent, since an approval is what keeps instructions hidden in a page from acting; an agent may answer approved false, with a reason, when the person declines',
      },
      { status: 'succeeded', output: { answer: { approved: false } } },
      { status: 'succeeded', output: { answer: { approved: true } } },
    ]);
  });
});

describe('the runs that go on once their requests are answered or expire', () => {
  it('go on with a run whose approval request was answered, at once, caused by its request, and its request then leaves the list', async () => {
    const { playbook, going, goneOn, wentOn } = await askedToApprove();
    const now = Date.now() + 60_000;
    await playbook.call(answerInteraction, answer(true), priya);

    expect(await goneOn(now)).toBe(1);
    expect(wentOn).toMatchObject([{ id: runId, lineage: { correlationId: runId } }]);
    expect(wentOn[0]?.lineage.causationId).toBeTypeOf('string');
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { answer: { approved: true } } },
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
    expect(await Effect.runPromise(going.due(now, 16, true))).toEqual([]);
  });

  it('go on with a run whose approval request expired, with no answer, and not before', async () => {
    const expired = Date.now() - 1000;
    const { playbook, going, goneOn } = await askedToApprove(new Date(expired).toISOString());

    expect(await Effect.runPromise(going.nextDueAt(0))).toBe(expired);
    expect(await goneOn(expired - 1)).toBe(0);
    expect(await goneOn(expired)).toBe(1);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'succeeded', output: { answer: null } } });
  });

  it('leave an expired approval request to its run, which the due work of requests never ends unanswered', async () => {
    const { playbook } = await askedToApprove();

    await playbook.performDue(expiresAt + 1);

    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });

  it('end nothing of an attempt a cancel stops, in the capability of these tests, which makes no call', () => {
    const prepared = Effect.runSync(approving.prepare(later));

    expect(prepared.cancelledAttempt({ startedAt: later, modelCallsBefore: 0, calls: [] })).toEqual({ ends: [] });
  });

  it('are none in the lane of what calls nothing outside', async () => {
    const { going } = await askedToApprove();

    expect([
      await Effect.runPromise(going.due(expiresAt, 16, false)),
      await Effect.runPromise(going.nextDueAt(0, false)),
    ]).toEqual([[], null]);
  });
});
