import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { filterStops } from '../filtering/filter-matching.ts';
import { subscribed } from '../reaction-testing/event-subscriptions.ts';
import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import { alpha, byAdmin, recorded } from '../reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { readingMeasured, type MeasuredReads } from '../waiting-testing/measured-reads.ts';
import { reactionConsumersOf } from './reaction-consumers.ts';

const started = { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} };

const ofTheRun = {
  ...byAdmin,
  runId: 'r-close',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 1,
};

function subscriptionStartsOn(database: MeasuredReads['database']) {
  const consumers = reactionConsumersOf(
    {
      database,
      submitted: () => Effect.die('No run is offered an event here'),
      clock: { now: () => 0, sleep: () => Effect.void },
      reports: { unsettled: () => Effect.void, trouble: () => Effect.void, note: () => Effect.void },
    },
    {
      options: recordedReactions().options,
      refusals: { refuse: () => Effect.void, flush: () => Effect.succeed(0) },
      stops: filterStops(),
    },
    { start: () => Effect.void, startDeferred: () => Effect.succeed(0) },
  );
  const starts = consumers.find(({ name }) => name === 'subscription_starts');
  if (starts === undefined) {
    throw new Error('No consumer starts the subscriptions of an event');
  }
  return starts;
}

describe('the workflow a run began, as the starts of an event trigger learn it', () => {
  it('is read from the first fact of the run alone, and nothing of the output of 100 KiB its end holds', async () => {
    const measured = readingMeasured(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const stream = `${alpha}runs/r-close`;
    const output = { text: 'x'.repeat(100 * 1024) };
    await recorded(measured.database.store, stream, { type: 'run_started', data: started }, ofTheRun);
    await recorded(measured.database.store, stream, { type: 'run_succeeded', data: { output, record: {} } }, ofTheRun);
    await subscribed(measured.database, 'close', { type: 'go' });
    const readToRecord = measured.bytesRead();

    const { deliveries } = await Effect.runPromise(
      subscriptionStartsOn(measured.database).batchOf(followedRecordOf(null, { topRun: 'r-close' }), undefined, 10),
    );

    expect([deliveries, measured.bytesRead() - readToRecord]).toEqual([[], JSON.stringify(started).length]);
  });
});
