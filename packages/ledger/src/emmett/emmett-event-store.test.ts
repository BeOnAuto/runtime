import { DeadlockError } from '@event-driven-io/dumbo';
import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventAppenderOf, VersionConflict } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { onEachSQLiteDriver } from '../testing/sqlite-drivers.ts';
import { tally } from '../testing/tally.ts';
import { dataAsWritten, emmettEventStore, rodeNowhere } from './emmett-event-store.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const firstThree = [1, 2, 3].map((n) => ({ type: 'counted', data: { n } }));

function counted(count: number): readonly { readonly type: 'counted'; readonly data: { readonly by: number } }[] {
  return Array.from({ length: count }, () => ({ type: 'counted', data: { by: 1 } }));
}

const sqliteDrivers = onEachSQLiteDriver(() => nodeSqliteDumboDriver);

describe.each(sqliteDrivers)('an event store over an Emmett event store, on SQLite through $through', (sqlite) => {
  it('keeps the data of each event as the store it is given makes it', async () => {
    const emmett = sqlite.anEmmettStoreInMemory();
    const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
    await store.migrate();

    await store.append(run, firstThree, { expectedVersion: 0, context: stamped });
    const stored = await emmett.readStream(run);

    expect(stored.events.map(({ data }: { readonly data: unknown }) => data)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('gives the events after a version, and that version when nothing follows it', async () => {
    const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), { data: dataAsWritten, mostEventsInOneAppend: 8 });
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

describe.each(sqliteDrivers)(
  'a stream read a page at a time from an event store over an Emmett event store, on SQLite through $through',
  (sqlite) => {
    it('measures each fact as it reads it back, with the payloads it keeps outside, and answers at least one a page', async () => {
      const holders = new Map([
        ['note_written', { payloads: [{ sha256: '/body_sha256', bytes: '/body_bytes' } as const] }],
      ]);
      const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), {
        data: dataAsWritten,
        mostEventsInOneAppend: 8,
        holders,
      });
      await store.migrate();
      const kept = { body_sha256: 'a'.repeat(64), body_bytes: 100 };
      await store.append(run, [...firstThree, { type: 'note_written', data: kept, payloadBytes: 100 }], {
        expectedVersion: 0,
        context: stamped,
      });

      const pages = [
        await store.readPage(run, 0, 14),
        await store.readPage(run, 2, 150),
        await store.readPage(run, 3, 1),
        await store.readPage(run, 4, 100),
      ];

      expect(pages.map(({ messages, through, more }) => [messages.length, through, more])).toEqual([
        [2, 2, true],
        [1, 3, true],
        [1, 4, false],
        [0, 4, false],
      ]);
    });
  },
);

describe.each(sqliteDrivers)(
  'an append to an event store over an Emmett event store, on SQLite through $through',
  (sqlite) => {
    it.each([0, 2, 4])(
      'meets a version conflict and appends nothing when it expects %i of a stream at version 3',
      async (expected) => {
        const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), {
          data: dataAsWritten,
          mostEventsInOneAppend: 8,
        });
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
      const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), { data: dataAsWritten, mostEventsInOneAppend: 3 });
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
      const emmett = sqlite.anEmmettStoreInMemory();
      const store = emmettEventStore(emmett, { data: dataAsWritten, mostEventsInOneAppend: 8 });
      await store.migrate();

      await store.close();

      await expect(emmett.readStream(run)).rejects.toThrow('Singleton connection pool has been closed');
    });
  },
);

describe.each(sqliteDrivers)(
  'an append that carries work to do inside its transaction, on SQLite through $through',
  (sqlite) => {
    it('fails when the Emmett store under it runs no work of the ledger before its commit', async () => {
      const store = emmettEventStore(sqlite.anEmmettStoreInMemory(), { data: dataAsWritten, mostEventsInOneAppend: 8 });
      await store.migrate();
      const done: string[] = [];

      const appended = store.appendWithin(
        run,
        [{ type: 'counted', data: { n: 1 } }],
        { expectedVersion: 0, context: stamped },
        () => {
          done.push('the work');
          return Promise.resolve();
        },
      );

      await expect(appended).rejects.toThrow(rodeNowhere);
      expect(done).toEqual([]);
    });
  },
);

describe.each(sqliteDrivers)('an append whose store answers a deadlock, on SQLite through $through', (sqlite) => {
  it('meets a version conflict, so the decision is made again', async () => {
    const store = emmettEventStore(
      {
        ...sqlite.anEmmettStoreInMemory(),
        appendToStream: () => Promise.reject(new DeadlockError('deadlock detected')),
      },
      { data: dataAsWritten, mostEventsInOneAppend: 8 },
    );

    expect(
      await outcomeOf(
        eventAppenderOf(store, tally.eventSchema)(run, counted(1), { expectedVersion: 0, context: stamped }),
      ),
    ).toEqual(Result.fail(new VersionConflict()));
  });
});
