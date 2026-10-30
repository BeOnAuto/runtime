import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf, VersionConflict } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { dataAsWritten, emmettEventStore, type EmmettStore } from './emmett-event-store.ts';

function anEmmettStore(): EmmettStore {
  const store = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName: ':memory:',
    schema: { autoMigration: 'None' },
  });
  onTestFinished(() => store.close());
  return store;
}

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const firstThree = [1, 2, 3].map((n) => ({ type: 'counted', data: { n } }));

function counted(count: number): readonly { readonly type: 'counted'; readonly data: { readonly by: number } }[] {
  return Array.from({ length: count }, () => ({ type: 'counted', data: { by: 1 } }));
}

describe('an event store over an Emmett event store', () => {
  it('keeps the data of each event as the store it is given makes it', async () => {
    const emmett = anEmmettStore();
    const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
    await store.migrate();

    await store.append(run, firstThree, { expectedVersion: 0, context: stamped });
    const stored = await emmett.readStream(run);

    expect(stored.events.map(({ data }: { readonly data: unknown }) => data)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('gives the events after a version, and that version when nothing follows it', async () => {
    const store = emmettEventStore(anEmmettStore(), { data: dataAsWritten, mostEventsInOneAppend: 8 });
    await store.migrate();
    await store.append(run, firstThree, { expectedVersion: 0, context: stamped });

    expect(await store.read(run, 1)).toMatchObject({
      version: 3,
      messages: [
        { type: 'counted', data: { n: 2 }, context: stamped },
        { type: 'counted', data: { n: 3 }, context: stamped },
      ],
    });
    expect(await store.read(run, 3)).toEqual({ version: 3, messages: [] });
  });
});

describe('an append to an event store over an Emmett event store', () => {
  it.each([0, 2, 4])(
    'meets a version conflict and appends nothing when it expects %i of a stream at version 3',
    async (expected) => {
      const store = emmettEventStore(anEmmettStore(), { data: dataAsWritten, mostEventsInOneAppend: 8 });
      await store.migrate();
      await store.append(run, firstThree, { expectedVersion: 0, context: stamped });

      expect(
        await outcomeOf(
          eventAppenderOf(store, tally.eventSchema)(run, counted(1), { expectedVersion: expected, context: stamped }),
        ),
      ).toEqual(Result.fail(new VersionConflict()));
      expect((await store.read(run)).version).toBe(3);
    },
  );

  it('takes in one append as many events as it is told, and a decision of more is a defect', async () => {
    const store = emmettEventStore(anEmmettStore(), { data: dataAsWritten, mostEventsInOneAppend: 3 });
    await store.migrate();
    const append = eventAppenderOf(store, tally.eventSchema);

    await expect(outcomeOf(append(run, counted(4), { expectedVersion: 0, context: stamped }))).rejects.toThrow(
      `A decision on ${run} gave 4 events, more than 3`,
    );
    expect(await outcomeOf(append(run, counted(3), { expectedVersion: 0, context: stamped }))).toMatchObject({
      _tag: 'Success',
    });
  });

  it('closes the store under it', async () => {
    const emmett = anEmmettStore();
    const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
    await store.migrate();

    await store.close();

    await expect(emmett.readStream(run)).rejects.toThrow('Singleton connection pool has been closed');
  });
});
