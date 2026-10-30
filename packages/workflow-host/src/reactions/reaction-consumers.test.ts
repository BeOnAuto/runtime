import { callKeyText, type RunInput } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { filterStops } from '../filtering/filter-matching.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { reactionConsumersOf } from './reaction-consumers.ts';

type Consumers = ReturnType<typeof reactionConsumersOf>;

interface Declining {
  readonly consumers: Consumers;
  readonly offered: readonly RunInput[];
  readonly notes: readonly unknown[];
}

const playbookKey = 'playbook/acme/alpha/';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runKey = `acme/alpha/${runId}`;

function listening(database: HostDatabase): Promise<void> {
  return Effect.runPromise(
    insertedListener(database, {
      runKey,
      listener: callKeyText({ runId: runKey, reference: '/do/0/wait', run: 1 }),
      playbookKey,
      streamId: `${playbookKey}run-logs/${runId}`,
      armedBy: 1,
      filters: JSON.stringify([{ type: 'go', data: '${ $data.ready === true }' }]),
      workflow: 'waiting',
      version: 1,
      passed: true,
    }),
  );
}

function decliningEveryOffer(database: HostDatabase): Declining {
  const offered: RunInput[] = [];
  const notes: unknown[] = [];
  const consumers = reactionConsumersOf(
    {
      database,
      submitted: (input) =>
        Effect.sync(() => {
          offered.push(input);
          return { outcome: 'stale', version: 2, declined: 'The run took no event of this kind' } as const;
        }),
      clock: { now: () => 0, sleep: () => Effect.void },
      reports: {
        unsettled: () => Effect.void,
        trouble: () => Effect.void,
        note: (note) =>
          Effect.sync(() => {
            notes.push(note);
          }),
      },
    },
    {
      options: recordedReactions().options,
      refusals: { refuse: () => Effect.void, flush: () => Effect.succeed(0) },
      stops: filterStops(),
    },
    { start: () => Effect.void, startDeferred: () => Effect.succeed(0) },
  );
  return { consumers, offered, notes };
}

function named(consumers: Consumers, name: string): Consumers[number] {
  const found = consumers.find((consumer) => consumer.name === name);
  if (found === undefined) {
    throw new Error(`No consumer is named ${name}`);
  }
  return found;
}

describe('the consumers of the reactions of a host', () => {
  it('offer an event to a run listening for it, and note the reason the run gives when it declines the offer', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database);
    const { consumers, offered, notes } = decliningEveryOffer(database);

    const offers = named(consumers, 'listener_offers');
    const batch = await Effect.runPromise(offers.batchOf(followedRecordOf({ ready: true }), undefined, 10));
    await Effect.runPromise(
      Effect.forEach(batch.deliveries, ({ deliver }) => Effect.ignore(deliver), { discard: true }),
    );

    expect(offered).toMatchObject([{ kind: 'event_offered', runId: runKey, key: 'record-1' }]);
    expect(notes).toEqual([
      {
        kind: 'offer_declined',
        run: { org: 'acme', playbook: 'alpha', runId },
        detail: 'The run took no event of this kind',
      },
    ]);
  });
});
