import { SQL } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent } from '../event-store.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { stamped } from '../testing/happenings.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { isVersionConflict } from '../version-conflict.ts';
import type { BeforeCommit } from './joined-appends.ts';

const alpha = 'playbook/acme/alpha/';

const place = { expectedVersion: 0, context: stamped };

const noted: readonly EncodedEvent[] = [{ type: 'noted', data: {} }];

interface Gate {
  readonly entered: Promise<void>;
  readonly letGo: () => void;
  readonly passed: (messages: readonly unknown[]) => Promise<void>;
}

function aGate(): Gate {
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    letGo: () => {
      held.resolve();
    },
    passed: async (messages) => {
      if (messages.length > 1) {
        entered.resolve();
        await held.promise;
      }
    },
  };
}

async function aStoreWith(onBeforeCommit: BeforeCommit) {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName, hooks: { onBeforeCommit } }));
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

function heldBackUntilItCommits(): void {
  it('shows a reader none of its facts while its transaction is open, and all of them once it commits', async () => {
    const gate = aGate();
    const store = await aStoreWith(gate.passed);
    const factsOfAlpha = () =>
      store.readAppendedFacts({ kind: 'playbook', playbookKey: alpha }, { after: null, most: 10, dataOf: [] });

    const appending = store.multiStreamAppend([
      { stream: `${alpha}notes/b`, events: noted, place },
      { stream: `${alpha}notes/a`, events: noted, place },
    ]);
    await gate.entered;
    const whileOpen = [await factsOfAlpha(), (await store.log.after(undefined, 10)).events.length];
    gate.letGo();
    await appending;

    expect(whileOpen).toEqual([expect.objectContaining({ held: true, facts: [] }), 0]);
    expect(await factsOfAlpha()).toMatchObject({
      held: true,
      facts: [
        { stream: `${alpha}notes/a`, version: 1 },
        { stream: `${alpha}notes/b`, version: 1 },
      ],
    });
  });
}

const writtenOnce: BeforeCommit = async (_messages, { transaction }) => {
  await transaction.execute.command(SQL`CREATE TABLE IF NOT EXISTS written_once (id INTEGER PRIMARY KEY)`);
  await transaction.execute.command(SQL`INSERT INTO written_once (id) VALUES (1)`);
};

function aRowWrittenTwiceMetAsAConflict(): void {
  it('meets a row its transaction writes twice as a version conflict, as an append to one stream does, and keeps nothing', async () => {
    const store = await aStoreWith(writtenOnce);
    await store.append(`${alpha}notes/a`, noted, place);

    const refused = await Promise.all([
      store.append(`${alpha}notes/b`, noted, place).catch((error: unknown) => error),
      store
        .multiStreamAppend([
          { stream: `${alpha}notes/c`, events: noted, place },
          { stream: `${alpha}notes/d`, events: noted, place },
        ])
        .catch((error: unknown) => error),
    ]);

    expect(refused.map((error) => isVersionConflict(error))).toEqual([true, true]);
    expect((await store.log.after(undefined, 10)).events.map(({ stream }) => stream)).toEqual([`${alpha}notes/a`]);
  });
}

describe('An append to several streams on a SQLite file', () => {
  heldBackUntilItCommits();
  aRowWrittenTwiceMetAsAConflict();
});
