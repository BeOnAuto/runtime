import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Conflict, messageIdOf } from '@on.auto/operations';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { multiStreamAppenderOf, StreamRefused, VersionConflict, type MultiStreamAppends } from '../index.ts';
import { appendRefusedAs } from '../refusals/append-refused.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { happenings, noted, stamped } from '../testing/happenings.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

const one = 'playbook/acme/alpha/notes/one';

const other = 'playbook/acme/alpha/notes/other';

async function aStore() {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function rejectingWith(rejected: () => Error): MultiStreamAppends {
  return { multiStreamAppend: () => Promise.reject(rejected()) };
}

const appended = [
  { stream: other, events: [noted('noted', 1)], place: { expectedVersion: 0, context: stamped } },
  {
    stream: one,
    events: [noted('noted', 2), noted('noted', 3)],
    place: { expectedVersion: 0, context: { ...stamped, by: 'another tester' } },
  },
];

async function failureOf(store: MultiStreamAppends): Promise<unknown> {
  const exit = await Effect.runPromiseExit(multiStreamAppenderOf(store, happenings.eventSchema)(appended));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

describe('the appender of decided events to several streams', () => {
  it('encodes the events of each stream with its own context and appends them all at once', async () => {
    const store = await aStore();

    await Effect.runPromise(multiStreamAppenderOf(store, happenings.eventSchema)(appended));

    expect(
      (await store.read(one)).messages.map(({ data, context, lineage }) => [data, context.by, lineage.id]),
    ).toEqual([
      [{ detail: 2 }, 'another tester', messageIdOf(one, 1)],
      [{ detail: 3 }, 'another tester', messageIdOf(one, 2)],
    ]);
    expect((await store.read(other)).messages.map(({ data, context }) => [data, context.by])).toEqual([
      [{ detail: 1 }, 'tester'],
    ]);
  });

  it('fails with a version conflict when a stream was not at the version expected, so a decision is made again', async () => {
    const store = await aStore();
    await store.append(one, [{ type: 'noted', data: { detail: 0 } }], { expectedVersion: 0, context: stamped });

    expect(await failureOf(store)).toEqual(new VersionConflict());
  });

  it('fails with the refusal of an inline projection, naming the stream whose fact it refused', async () => {
    const taken = new Conflict({ detail: 'The name is taken', kind: 'taken' });

    expect(await failureOf(rejectingWith(() => appendRefusedAs(taken, one)))).toEqual(
      new StreamRefused({ stream: one, conflict: taken }),
    );
  });

  it('takes any other failure of the store as a defect', async () => {
    const gone = new Error('The database is gone');

    expect(await failureOf(rejectingWith(() => gone))).toBe(gone);
  });
});
