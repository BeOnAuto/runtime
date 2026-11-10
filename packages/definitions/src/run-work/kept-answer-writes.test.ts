import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { PayloadsOutside } from '@on.auto/operations/payloads';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { answeredAlready, playbookBoundAnswerer } from '../index.ts';
import type { GivenAnswer } from '../runs/run-commands.ts';
import { answering, asked, askedLineage as lineage, askedRun as run, attempted } from '../testing/asked-runs.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';

const thePlaybook = { id: 'playbook:alpha', name: 'alpha' };

const answer = { choice: 'approve', reason: 'r'.repeat(17_000) };

const kept = keptArmOf(answer);

const keptAnswer = { answer_sha256: kept.sha256, answer_bytes: kept.bytes };

function keepingOutside<A, E>(effect: Effect.Effect<A, E>) {
  return attempted(effect.pipe(Effect.provideService(PayloadsOutside, true)));
}

describe('the answer to a request, where its playbook keeps large values outside its runs', () => {
  it('is kept once, before the fact that names it, and the same answer in another order again records nothing', async () => {
    const { record, recorded, ledger } = await asked();

    const first = await keepingOutside(record(run, answering(answer, 'ada'), lineage));
    const again = await keepingOutside(
      record(run, answering({ reason: answer.reason, choice: answer.choice }, 'grace'), lineage),
    );
    const text = await Effect.runPromise(ledger.service.content.getHead(run, kept.sha256));

    expect(Result.map(again, ({ id }) => id)).toEqual(Result.map(first, ({ id }) => id));
    expect((await recorded()).slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['request_answered', { ...keptAnswer, claimed_for: 'ada', answered_by: thePlaybook }],
    ]);
    expect(text).toMatchObject({ bytes: kept.bytes, mediaType: 'application/json' });
  });

  it('is refused for another answer once one is kept, telling them apart by the one it reads', async () => {
    const { record } = await asked();
    await keepingOutside(record(run, answering(answer), lineage));

    expect(await keepingOutside(record(run, answering({ ...answer, choice: 'reject' }), lineage))).toEqual(
      Result.fail(answeredAlready),
    );
  });

  it('is given by a caller within the playbook, kept the same way, and another large answer after it is a conflict', async () => {
    const { ledger, recorded } = await asked();
    const ada = { id: 'person:ada', name: 'Ada Lovelace' };
    const answeredWith = (given: GivenAnswer) =>
      keepingOutside(
        playbookBoundAnswerer(run.id, given, ada, lineage).pipe(
          Effect.provideContext(playbookLedgerOf(ledger.service, run)),
          Effect.provideService(PlaybookContext, { org: run.org, playbook: run.playbook }),
        ),
      );

    const results = [
      await answeredWith({ answer }),
      await answeredWith({ answer: { reason: answer.reason, choice: answer.choice } }),
      await answeredWith({ answer: { ...answer, choice: 'reject' } }),
    ];

    expect(results).toMatchObject([{ _tag: 'Success' }, { _tag: 'Success' }, Result.fail(answeredAlready)]);
    expect((await recorded()).slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['request_answered', { ...keptAnswer, answered_by: ada }],
    ]);
  });
});
