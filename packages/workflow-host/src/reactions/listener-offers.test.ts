import { Conflict } from '@on.auto/operations';
import { callKeyText, type Json, type Submission } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { followedRecordOf, saidRefusals } from '../reaction-testing/followed-records.ts';
import { countingMatches, stopsByItsMemory } from '../reaction-testing/trigger-starting.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { listenerOffers } from './listener-offers.ts';

const playbookKey = 'playbook/acme/alpha/';

const applied: Submission = { outcome: 'applied', version: 2 };

const declinedOffer: Submission = { outcome: 'stale', version: 2, declined: 'The run took no event of this kind' };

interface Offering {
  readonly offers: () => readonly string[];
  readonly said: () => readonly string[];
  readonly evaluated: () => readonly string[];
  readonly consumer: ReturnType<typeof listenerOffers>;
}

function listening(database: HostDatabase, run: string, filters: readonly Json[], workflow = `wf-${run}`) {
  const runKey = `acme/alpha/${run}`;
  return Effect.runPromise(
    insertedListener(database, {
      runKey,
      listener: callKeyText({ runId: runKey, reference: '/do/0/wait', run: 1 }),
      playbookKey,
      streamId: `${playbookKey}run-logs/${run}`,
      armedBy: 1,
      filters: JSON.stringify(filters),
      workflow,
      version: 1,
      passed: true,
    }),
  );
}

function offering(database: HostDatabase, answer: (runKey: string) => Effect.Effect<Submission, Conflict>): Offering {
  const offers: string[] = [];
  const { refusals, said, say } = saidRefusals();
  const { match, stops, evaluated } = countingMatches();
  const consumer = listenerOffers({
    database,
    refusals,
    offer: ({ runKey, key, listener }) =>
      Effect.andThen(
        Effect.sync(() => {
          offers.push(`${runKey} ${key} ${listener.reference}`);
        }),
        answer(runKey),
      ),
    declined: (runKey, detail) => say(`${runKey} declined: ${detail}`),
    match,
    stops,
    now: () => 0,
  });
  return { offers: () => offers, said, evaluated, consumer };
}

function declinedByTheFirst(runKey: string): Effect.Effect<Submission, Conflict> {
  return runKey.endsWith('run-a')
    ? Effect.succeed(declinedOffer)
    : Effect.fail(new Conflict({ detail: 'The ledger cannot be reached' }));
}

function outcomesOf(consumer: Offering['consumer'], followed: ReturnType<typeof followedRecordOf>) {
  return Effect.runPromise(
    Effect.flatMap(consumer.batchOf(followed, undefined, 10), ({ deliveries }) =>
      Effect.forEach(deliveries, ({ workflow, deliver }) =>
        Effect.map(Effect.isSuccess(deliver), (made) => `${workflow} ${made ? 'delivered' : 'waits'}`),
      ),
    ),
  );
}

function deliveredAll(consumer: Offering['consumer'], followed: ReturnType<typeof followedRecordOf>, most: number) {
  return Effect.runPromise(
    Effect.flatMap(consumer.batchOf(followed, undefined, most), (batch) =>
      Effect.as(
        Effect.forEach(batch.deliveries, ({ deliver }) => Effect.ignore(deliver), { discard: true }),
        batch,
      ),
    ),
  );
}

describe('the offers of an event to the runs that listen for its type', () => {
  it('go to each run whose filter takes it, but not to the run that emitted it', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go', data: { region: 'us' } }]);
    await listening(database, 'run-c', [{ type: 'go' }]);
    await listening(database, 'run-d', [{ type: '${ "go" }' }, { type: 'go', data: { region: 'eu' } }]);
    const { offers, consumer } = offering(database, () => Effect.succeed(applied));

    const batch = await deliveredAll(
      consumer,
      followedRecordOf({ region: 'eu' }, { emitter: { runId: 'run-c', workflow: 'wf-run-c' } }),
      100,
    );

    expect([offers(), batch.more]).toEqual([
      ['acme/alpha/run-a record-1 /do/0/wait', 'acme/alpha/run-d record-1 /do/0/wait'],
      false,
    ]);
  });

  it('are taken in batches, each from where the last one ended', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go' }]);
    await listening(database, 'run-c', [{ type: 'go' }]);
    const { offers, consumer } = offering(database, () => Effect.succeed(applied));
    const followed = followedRecordOf(null);

    const first = await deliveredAll(consumer, followed, 2);
    const second = await Effect.runPromise(consumer.batchOf(followed, first.through, 2));

    expect([offers().length, first.more, second.deliveries.length, second.more]).toEqual([2, true, 1, false]);
  });
});

describe('the filter of the runs listening at one task of a version that goes past a bound', () => {
  it('keeps the event it was stopped on by its memory waiting, and after three such stops in a row, in any of the runs, is not evaluated again for that task and version', async () => {
    const database = await openedOn(await onSQLite());
    const filling = { type: 'go', data: stopsByItsMemory };
    await ['run-a', 'run-b', 'run-c'].reduce<Promise<unknown>>(
      (before, run) =>
        before.then(() => listening(database, run, [filling, { type: 'go', data: { region: 'eu' } }], 'wf')),
      Promise.resolve(),
    );
    const { offers, said, evaluated, consumer } = offering(database, () => Effect.succeed(applied));
    const american = followedRecordOf({ region: 'us' });

    const first = await outcomesOf(consumer, american);
    const atFirst = evaluated().length;
    const again = await outcomesOf(consumer, american);
    await deliveredAll(consumer, followedRecordOf({ region: 'eu' }), 10);

    expect([first, again]).toEqual([['wf waits', 'wf waits'], []]);
    expect([atFirst, evaluated().length]).toEqual([6, 12]);
    expect(offers()).toHaveLength(3);
    expect(said()).toEqual([
      expect.stringContaining(
        "wf: The filter of a listen task of the workflow was stopped by its deadline or its memory 3 times in a row, so the playbook's events are not offered through it again for this version of the workflow; events sent to its runs still reach them: ",
      ),
    ]);
  });
});

describe('an offer of an event to a listening run', () => {
  it('is said when the run declines it, fails when it cannot be made, and is said when skipped', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go' }]);
    const { said, consumer } = offering(database, declinedByTheFirst);
    const followed = followedRecordOf(null);

    const { deliveries } = await Effect.runPromise(consumer.batchOf(followed, undefined, 10));
    const outcomes = await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => Effect.isSuccess(deliver)));
    await Effect.runPromise(
      Effect.forEach(deliveries.slice(1), ({ skipped }) => skipped('The ledger cannot be reached')),
    );

    expect(outcomes).toEqual([true, false]);
    expect(said()).toEqual([
      'acme/alpha/run-a declined: The run took no event of this kind',
      'wf-run-b: An event could not be offered to a run waiting for it: The ledger cannot be reached',
    ]);
  });
});
