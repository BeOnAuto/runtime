import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { emmettEventStore, type EmmettStore } from '../emmett/emmett-event-store.ts';
import { eventAppenderOf, VersionConflict } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { dataAsJsonText } from './json-text.ts';

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

const awkward = { zeta: 'a NUL \u0000 inside', a: { y: 'half a pair \uD800 alone', x: [1, null] } };

describe('the data of an event kept as its JSON text', () => {
  it('is stored under json, and comes back exactly, keys in order', async () => {
    const emmett = anEmmettStore();
    const store = emmettEventStore(emmett, { data: dataAsJsonText, mostEventsInOneAppend: 64 });
    await store.migrate();

    await store.append(run, [{ type: 'noted', data: awkward }], { expectedVersion: 0, context: stamped });
    const read = await store.read(run);
    const stored = await emmett.readStream(run);

    expect(read).toMatchObject({ version: 1, messages: [{ data: awkward }] });
    expect(JSON.stringify(read.messages.map(({ data }) => data))).toBe(JSON.stringify([awkward]));
    expect(
      stored.events.map(({ type, data }: { readonly type: string; readonly data: unknown }) => ({ type, data })),
    ).toEqual([{ type: 'noted', data: { json: JSON.stringify(awkward) } }]);
  });

  it('is appended only at the version expected, and a wrong version meets a version conflict', async () => {
    const store = emmettEventStore(anEmmettStore(), { data: dataAsJsonText, mostEventsInOneAppend: 64 });
    await store.migrate();
    await store.append(run, [{ type: 'noted', data: awkward }], { expectedVersion: 0, context: stamped });

    expect(
      await outcomeOf(
        eventAppenderOf(store, tally.eventSchema)(run, [{ type: 'counted', data: { by: 1 } }], {
          expectedVersion: 0,
          context: stamped,
        }),
      ),
    ).toEqual(Result.fail(new VersionConflict()));
    expect(await store.read(run)).toMatchObject({ version: 1, messages: [{ data: awkward }] });
  });
});
