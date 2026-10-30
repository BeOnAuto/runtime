import { Conflict, streamPrefixOfPlaybook, type StreamWriter } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredAlready,
  answeredFirst,
  playbookBoundAnswerer,
  cancelledUnanswered,
  endedUnanswered,
  runCanceller,
  runSettler,
  workRecorder,
  type CancelRequest,
} from '../index.ts';
import {
  answering,
  asked,
  askedLineage as lineage,
  askedRun as run,
  askingFacts,
  attempted,
} from '../testing/asked-runs.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const thePlaybook = { id: 'playbook:alpha', name: 'alpha' };

describe('the answer to a request a run waits on', () => {
  it('is one fact on the run, kept by the run with who gave it and when, and the same answer again records nothing', async () => {
    const { record, recorded, state } = await asked();

    const answered = await Effect.runPromise(record(run, answering({ choice: 'approve' }, 'ada'), lineage));
    const again = await Effect.runPromise(record(run, answering({ choice: 'approve' }, 'grace'), lineage));

    expect(again.id).toBe(answered.id);
    expect((await recorded()).slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['request_answered', { answer: { choice: 'approve' }, claimed_for: 'ada', answered_by: thePlaybook }],
    ]);
    expect((await state())?.answer).toEqual({
      answer: { choice: 'approve' },
      claimedFor: 'ada',
      by: thePlaybook,
      at: answered.at,
    });
  });

  it('is kept with the reply that brought it, when a reply did', async () => {
    const { record, state } = await asked();
    const reply = { id: '1699.2', sender: 'ada' };

    const answered = await Effect.runPromise(
      record(run, { type: 'answer', answer: { answer: { choice: 'reject' }, reply } }, lineage),
    );

    expect((await state())?.answer).toEqual({
      answer: { choice: 'reject' },
      reply,
      by: thePlaybook,
      at: answered.at,
    });
  });

  it('is a conflict for another answer once the run took one, in words that say so', async () => {
    const { record } = await asked();
    await Effect.runPromise(record(run, answering({ choice: 'approve' }), lineage));

    expect(await attempted(record(run, answering({ choice: 'reject' }), lineage))).toEqual(
      Result.fail(answeredAlready),
    );
    expect(answeredAlready.detail).toBe(
      'The run already took another answer, and a run takes one answer, so it takes no other',
    );
  });
});

describe('the answer to a run that takes none', () => {
  it('is refused for a run that ended, a run there is not, and a run that waits on no request', async () => {
    const now = await asked({ now: true });
    const handedOn = await withHandOn();
    await handedOn.running();

    expect([
      await attempted(now.record(run, answering({ choice: 'approve' }), lineage)),
      await attempted(now.record({ ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }, answering({}), lineage)),
      await attempted(
        workRecorder(handedOn.ledger.service, askingFacts)({ ...run, id: relayedId }, answering({}), lineage),
      ),
    ]).toEqual([
      Result.fail(endedUnanswered),
      Result.fail(endedUnanswered),
      Result.fail(new Conflict({ detail: 'The run waits on no request that takes an answer' })),
    ]);
  });
});

const notNeeded: CancelRequest = { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' };

describe('the answer to a run whose cancel was asked', () => {
  it('is refused, though the answer the run took before the cancel answers as it did', async () => {
    const answeredBefore = await asked();
    const cancelledBefore = await asked();
    await Effect.runPromise(answeredBefore.record(run, answering({ choice: 'approve' }), lineage));
    await Effect.runPromise(runCanceller(answeredBefore.ledger.service)(run, notNeeded, lineage));
    await Effect.runPromise(runCanceller(cancelledBefore.ledger.service)(run, notNeeded, lineage));

    const again = await attempted(answeredBefore.record(run, answering({ choice: 'approve' }), lineage));
    const refused = await attempted(cancelledBefore.record(run, answering({ choice: 'approve' }), lineage));

    expect([Result.isSuccess(again), refused]).toEqual([true, Result.fail(cancelledUnanswered)]);
    expect(
      [await answeredBefore.recorded(), await cancelledBefore.recorded()].map((records) =>
        records.map(({ type }) => type),
      ),
    ).toEqual([
      ['run_started', 'run_deferred', 'request_answered', 'run_cancel_requested'],
      ['run_started', 'run_deferred', 'run_cancel_requested'],
    ]);
    expect(cancelledUnanswered.detail).toBe('A cancel of the run was asked before it took an answer, so it takes none');
  });
});

describe('the settlement of a run that took an answer', () => {
  it('is the answer: a settlement that says nobody answered is refused once the run took one', async () => {
    const { record, ledger } = await asked();
    await Effect.runPromise(record(run, answering({ choice: 'approve' }), lineage));
    const settle = runSettler(ledger.service);

    expect(
      await attempted(
        settle(run, { status: 'rejected', reason: 'unanswered', kind: 'expired', detail: 'Nobody answered' }),
      ),
    ).toEqual(Result.fail(answeredFirst));
    expect(
      await Effect.runPromise(settle(run, { status: 'succeeded', output: { choice: 'approve' }, by: 'ada' })),
    ).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
  });
});

describe('the answer a caller gives to a request a run waits on', () => {
  it('is recorded on the run of the playbook as the caller that gave it, and another answer after it is a conflict', async () => {
    const { ledger, recorded } = await asked();
    const inAlpha: StreamWriter = {
      execute: (stream, decider, command, given) =>
        ledger.service.execute(`${streamPrefixOfPlaybook(run)}${stream}`, decider, command, given),
    };
    const answer = playbookBoundAnswerer(inAlpha);

    const ada = { id: 'person:ada', name: 'Ada Lovelace' };
    await Effect.runPromise(answer(run.id.toUpperCase(), { answer: { choice: 'approve' } }, ada, lineage));

    expect((await recorded()).slice(2).map(({ type, data, context }) => [type, data, context.by])).toEqual([
      ['request_answered', { answer: { choice: 'approve' }, answered_by: ada }, 'person:ada'],
    ]);
    expect(
      await attempted(
        answer(run.id, { answer: { choice: 'reject' } }, { id: 'person:grace', name: 'Grace Hopper' }, lineage),
      ),
    ).toEqual(Result.fail(answeredAlready));
  });
});
