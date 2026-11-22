import {
  LedgerConnection,
  statement,
  statementOf,
  type ConnectionPorts,
  type Dialect,
  type LedgerServices,
} from '@on.auto/ledger';
import { Effect, ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import floor from './chat-floor.json' with { type: 'json' };
import { chatLayout, chatTablePrefix } from './chat-layout.ts';
import type { ChatRows, ConversationRow } from './chat-rows.ts';
import { chatRowsOpened } from './chat-tables.ts';

interface OnADatabase {
  readonly ledgerOn: () => Layer.Layer<LedgerServices>;
  readonly structure: () => Promise<unknown>;
}

interface ChatDatabaseEntry {
  readonly name: string;
  readonly aDatabase: () => Promise<OnADatabase>;
}

const relationsOfTheSchema: Readonly<Record<Dialect, ReturnType<typeof statement>>> = {
  sqlite: statement`SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT GLOB 'sqlite_*'`,
  postgresql: statement`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()
    UNION SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()`,
};

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

const theFloor = Schema.decodeUnknownSync(Schema.Struct({ layout: Schema.Number, made: Schema.Array(Schema.String) }))(
  floor,
);

const layoutRead = statement`SELECT layout FROM chat_layout`;

async function relationsIn(connection: ConnectionPorts): Promise<readonly string[]> {
  return decodeNames(await connection.read(relationsOfTheSchema[connection.dialect]))
    .map(({ name }) => name)
    .toSorted();
}

interface Connected {
  readonly connection: ConnectionPorts;
  readonly closed: () => Promise<void>;
}

async function connectedTo(layer: Layer.Layer<LedgerServices>): Promise<Connected> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return { connection: await runtime.runPromise(Effect.service(LedgerConnection)), closed: () => runtime.dispose() };
}

export async function rowsOnTheLedger(layer: Layer.Layer<LedgerServices>): Promise<ChatRows> {
  return chatRowsOpened((await connectedTo(layer)).connection);
}

const refusedAs = (found: number) => ({ _tag: 'chat_layout_refused', found, kept: chatLayout });

const refusedWithNoNumber = { _tag: 'chat_layout_refused', found: undefined, kept: chatLayout };

const leaseOf = (holder: string) => ({ holder, now: 1, until: 100 });

const conversation: ConversationRow = {
  id: 'id-a',
  keyId: 'key-of-id-a',
  connection: 'connection-1',
  account: 'account-1',
  conversation: 'conversation-1',
  thread: 'thread-1',
};

function openingBehaviour({ name, aDatabase }: ChatDatabaseEntry): void {
  const aConnection = async () => (await connectedTo((await aDatabase()).ledgerOn())).connection;

  describe(`the chat tables ${name}, as they open`, () => {
    it('lay their layout on a database the ledger made, every table and index beginning with their prefix', async () => {
      const connection = await aConnection();
      const before = await relationsIn(connection);

      await chatRowsOpened(connection);

      const made = (await relationsIn(connection)).filter((relation) => !before.includes(relation));
      expect(await connection.read(layoutRead)).toEqual([{ layout: chatLayout }]);
      expect(made).not.toEqual([]);
      expect(made.filter((relation) => !relation.startsWith(chatTablePrefix))).toEqual([]);
    });

    it('open a database in their layout again, as a server that restarts, keeping their rows and changing nothing', async () => {
      const { ledgerOn } = await aDatabase();
      const first = await connectedTo(ledgerOn());
      await (await chatRowsOpened(first.connection)).conversations.made(conversation, 1);
      const before = await relationsIn(first.connection);
      await first.closed();

      const { connection: again } = await connectedTo(ledgerOn());
      const rows = await chatRowsOpened(again);

      expect([await relationsIn(again), await again.read(layoutRead)]).toEqual([before, [{ layout: chatLayout }]]);
      expect(await rows.conversations.found(conversation)).toEqual(conversation);
    });

    it('lay their layout once when they are opened twice at once on a new database', async () => {
      const connection = await aConnection();

      await Promise.all([chatRowsOpened(connection), chatRowsOpened(connection)]);

      expect(await connection.read(layoutRead)).toEqual([{ layout: chatLayout }]);
    });

    it('make the tables they lack in their layout, as when their first opening ended after it laid the layout', async () => {
      const connection = await aConnection();
      await chatRowsOpened(connection);
      const made = await relationsIn(connection);
      await connection.write(statement`DROP TABLE chat_messages`);

      await chatRowsOpened(connection);

      expect(await relationsIn(connection)).toEqual(made);
    });
  });
}

function refusingBehaviour({ name, aDatabase }: ChatDatabaseEntry): void {
  const aConnection = async () => (await connectedTo((await aDatabase()).ledgerOn())).connection;

  describe(`the chat tables ${name}, refused`, () => {
    it.each([
      ['a newer release carried forward', chatLayout + 1],
      ['no release makes', chatLayout - 1],
    ])('refuse a database whose layout %s, and leave it as it was', async (_case, found) => {
      const connection = await aConnection();
      await chatRowsOpened(connection);
      await connection.write(statement`UPDATE chat_layout SET layout = ${found}`);
      const before = await relationsIn(connection);

      await expect(chatRowsOpened(connection)).rejects.toMatchObject(refusedAs(found));
      expect([await relationsIn(connection), await connection.read(layoutRead)]).toEqual([before, [{ layout: found }]]);
    });

    it('refuse chat tables that hold no layout number, and make none', async () => {
      const connection = await aConnection();
      await chatRowsOpened(connection);
      await connection.write(statement`DROP TABLE chat_layout`);
      const before = await relationsIn(connection);

      await expect(chatRowsOpened(connection)).rejects.toMatchObject(refusedWithNoNumber);
      expect(await relationsIn(connection)).toEqual(before);
    });
  });
}

async function madeAtTheFloor(connection: ConnectionPorts): Promise<void> {
  await theFloor.made.reduce(async (before: Promise<unknown>, made) => {
    await before;
    return connection.write(statementOf([made], []));
  }, Promise.resolve());
}

function floorBehaviour({ name, aDatabase }: ChatDatabaseEntry): void {
  describe(`the chat tables ${name}, at their first layout`, () => {
    it('open a database made at their first layout to the structure of new tables', async () => {
      const [carried, made] = [await aDatabase(), await aDatabase()];
      const atTheFloor = await connectedTo(carried.ledgerOn());
      await madeAtTheFloor(atTheFloor.connection);
      await chatRowsOpened(atTheFloor.connection);
      await atTheFloor.closed();
      const anew = await connectedTo(made.ledgerOn());
      await chatRowsOpened(anew.connection);
      await anew.closed();

      expect(theFloor.layout).toBe(chatLayout);
      expect(
        await carried.structure(),
        'Tables made at their first layout differ from new ones: a change to a table needs a layout step',
      ).toEqual(await made.structure());
    });
  });
}

function sharedBehaviour({ name, aDatabase }: ChatDatabaseEntry): void {
  describe(`the chat tables ${name}, shared`, () => {
    it('give an arrival, and the lease on a conversation, to one of two connections that take it at once', async () => {
      const { ledgerOn } = await aDatabase();
      const one = await chatRowsOpened((await connectedTo(ledgerOn())).connection);
      const other = await chatRowsOpened((await connectedTo(ledgerOn())).connection);
      await one.conversations.made(conversation, 1);
      const arrival = {
        connection: 'connection-1',
        account: 'account-1',
        conversation: 'conversation-1',
        message: 'message-1',
        kind: 'mention',
      };

      const claimed = await Promise.all([one.arrivals.claimed(arrival, 1), other.arrivals.claimed(arrival, 1)]);
      const leased = await Promise.all([
        one.conversations.leaseTaken(conversation.id, leaseOf('one')),
        other.conversations.leaseTaken(conversation.id, leaseOf('other')),
      ]);

      expect([claimed.toSorted(), leased.toSorted()]).toEqual([
        [false, true],
        [false, true],
      ]);
    });

    it('delete conversations in groups of the most values a statement binds', async () => {
      const { connection } = await connectedTo((await aDatabase()).ledgerOn());
      const rows = await chatRowsOpened({ ...connection, mostBoundValues: 2 });
      const ids = ['id-a', 'id-b', 'id-c'];
      await Promise.all(ids.map((id) => rows.conversations.made({ ...conversation, id, thread: id }, 1)));

      await rows.conversations.deleted(ids);

      expect(await rows.conversations.selected({ connection: conversation.connection })).toEqual([]);
    });
  });
}

export function chatDatabaseBehaviour(entry: ChatDatabaseEntry): void {
  openingBehaviour(entry);
  refusingBehaviour(entry);
  floorBehaviour(entry);
  sharedBehaviour(entry);
}
