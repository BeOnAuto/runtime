import { statement, type Dialect, type Statement } from '@on.auto/ledger';
import { Data, Schema } from 'effect';

import type { ChatDatabase } from './chat-database.ts';

export const chatLayout = 1;

export const chatTablePrefix = 'chat_';

const layoutTable = 'chat_layout';

interface RefusedLayout {
  readonly found: number | undefined;
  readonly kept: number;
}

class ChatLayoutRefused extends Data.TaggedError('chat_layout_refused')<RefusedLayout & { readonly message: string }> {}

function changedOutside(kept: number): string {
  return `The chat tables in the database are not in a layout any release of Auto Runtime makes; this server keeps layout ${kept} of them. They were changed outside Auto Runtime: restore the database from a backup taken before that change`;
}

function ofANewerRelease(found: number, kept: number): string {
  return `The chat tables in the database are in layout ${found}, where this server keeps layout ${kept} of them. Upgrades go forward only. Open this database with the release that upgraded it, or a compatible later release`;
}

function chatLayoutRefused(refused: RefusedLayout): ChatLayoutRefused {
  const message =
    refused.found !== undefined && refused.found > refused.kept
      ? ofANewerRelease(refused.found, refused.kept)
      : changedOutside(refused.kept);
  return new ChatLayoutRefused({ ...refused, message });
}

const tablesOfTheSchema: Readonly<Record<Dialect, Statement>> = {
  sqlite: statement`SELECT name FROM sqlite_master WHERE type = 'table'`,
  postgresql: statement`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`,
};

const takenOneAtATime: Readonly<Record<Dialect, readonly Statement[]>> = {
  sqlite: [],
  postgresql: [statement`SELECT pg_advisory_xact_lock(hashtextextended('chat_layout', 0))`],
};

const layoutRead = statement`SELECT layout FROM chat_layout`;

const layoutTableMade = statement`CREATE TABLE IF NOT EXISTS chat_layout (
    one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row),
    layout INTEGER NOT NULL
  )`;

function layoutWritten(layout: number): Statement {
  return statement`INSERT INTO chat_layout (layout) VALUES (${layout}) ON CONFLICT (one_row) DO NOTHING`;
}

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

const decodeLayouts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ layout: Schema.Number })));

interface FoundLayout {
  readonly layout: number | undefined;
  readonly holdsTables: boolean;
}

async function layoutIn(database: ChatDatabase): Promise<number | undefined> {
  const [kept] = decodeLayouts(await database.read(layoutRead));
  return kept?.layout;
}

async function layoutFound(database: ChatDatabase, tables: readonly string[]): Promise<FoundLayout> {
  const names = new Set(decodeNames(await database.read(tablesOfTheSchema[database.dialect])).map(({ name }) => name));
  return {
    layout: names.has(layoutTable) ? await layoutIn(database) : undefined,
    holdsTables: tables.some((table) => names.has(table)),
  };
}

async function foundOnceLaid(database: ChatDatabase, tables: readonly string[]): Promise<FoundLayout> {
  const found = await layoutFound(database, tables);
  if (found.layout !== undefined || found.holdsTables) {
    return found;
  }
  await database.transaction([...takenOneAtATime[database.dialect], layoutTableMade, layoutWritten(chatLayout)]);
  return layoutFound(database, tables);
}

export async function chatLayoutKept(database: ChatDatabase, tables: readonly string[]): Promise<void> {
  const { layout } = await foundOnceLaid(database, tables);
  if (layout !== chatLayout) {
    throw chatLayoutRefused({ found: layout, kept: chatLayout });
  }
}
