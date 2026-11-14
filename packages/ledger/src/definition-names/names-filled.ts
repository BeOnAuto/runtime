import { SQL } from '@event-driven-io/dumbo';
import { contextOf } from '@on.auto/operations';
import {
  definitionsInTheAppend,
  judgedOf,
  nameKeyOf,
  type DefinitionNames,
  type HeldName,
  type NamedMessage,
} from '@on.auto/operations/definition-names';
import { Schema } from 'effect';

import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from '../layout/layout-dialects.ts';
import type { StepInCode } from '../layout/layout-steps.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { definitionNames } from './definition-names-table.ts';

const defaultPartition = 'emt:default';

const Counted = Schema.Union([Schema.Number, Schema.String]);

const StreamRows = Schema.Array(Schema.Struct({ stream_id: Schema.String }));

const SizedRows = Schema.Array(Schema.Struct({ stream_position: Counted, bytes: Counted }));

const StoredRows = Schema.Array(
  Schema.Struct({
    stream_id: Schema.String,
    stream_position: Counted,
    message_type: Schema.String,
    message_id: Schema.String,
    message_data: Schema.Unknown,
    message_metadata: Schema.Unknown,
  }),
);

interface Sized {
  readonly position: number;
  readonly bytes: number;
}

interface Page {
  readonly first: number;
  readonly last: number;
  readonly bytes: number;
}

function typesIn(types: readonly string[]): SQL {
  return SQL.merge(
    types.map((type) => SQL`${type}`),
    ', ',
  );
}

function byteLengthOf({ dialect }: LayoutDialect): SQL {
  return dialect === 'postgresql' ? SQL`octet_length(message_data::text)` : SQL`length(CAST(message_data AS BLOB))`;
}

function pagesOf(sizes: readonly Sized[], mostBytes: number): readonly Page[] {
  const pages: Page[] = [];
  for (const { position, bytes } of sizes) {
    const open = pages.at(-1);
    if (open === undefined || open.bytes + bytes > mostBytes) {
      pages.push({ first: position, last: position, bytes });
    } else {
      pages.splice(-1, 1, { first: open.first, last: position, bytes: open.bytes + bytes });
    }
  }
  return pages;
}

async function streamsHoldingNames(execute: StatementExecutor, names: DefinitionNames): Promise<readonly string[]> {
  const { rows } = await execute.query(
    SQL`SELECT stream_id FROM emt_streams
      WHERE partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id`,
  );
  return Schema.decodeUnknownSync(StreamRows)(rows)
    .map((row) => row.stream_id)
    .filter((stream) => names.holdsNames(stream));
}

async function sizesIn(execute: StatementExecutor, dialect: LayoutDialect, types: readonly string[], stream: string) {
  const { rows } = await execute.query(
    SQL`SELECT stream_position, ${byteLengthOf(dialect)} AS bytes FROM emt_messages
      WHERE stream_id = ${stream} AND message_type IN (${typesIn(types)})
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_position`,
  );
  return Schema.decodeUnknownSync(SizedRows)(rows).map((row) => ({
    position: Number(row.stream_position),
    bytes: Number(row.bytes),
  }));
}

interface PageOfAStream extends Page {
  readonly stream: string;
}

async function messagesOf(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  types: readonly string[],
  { stream, first, last }: PageOfAStream,
): Promise<readonly NamedMessage[]> {
  const { rows } = await execute.query(
    SQL`SELECT stream_id, stream_position, message_type, message_id, message_data, message_metadata FROM emt_messages
      WHERE stream_id = ${stream} AND stream_position >= ${first} AND stream_position <= ${last}
        AND message_type IN (${typesIn(types)}) AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_position`,
  );
  return Schema.decodeUnknownSync(StoredRows)(rows).map((row) => ({
    stream: row.stream_id,
    id: row.message_id,
    position: Number(row.stream_position),
    type: row.message_type,
    data: dialect.storedData(row.message_data),
    context: contextOf(dialect.storedMetadata(row.message_metadata)),
  }));
}

interface Filled {
  readonly held: ReadonlyMap<string, HeldName>;
  readonly seen: ReadonlySet<string>;
  readonly named: ReadonlySet<string>;
}

const nothingFilled: Filled = { held: new Map(), seen: new Set(), named: new Set() };

function filledAfter(names: DefinitionNames, before: Filled, messages: readonly NamedMessage[]): Filled {
  const held = new Map(before.held);
  const seen = new Set(before.seen);
  const named = new Set(before.named);
  for (const definition of definitionsInTheAppend(names, messages)) {
    const { definitionKey } = definition;
    const { end, changedBy } = judgedOf(names, definition, held.get(definitionKey));
    held.delete(definitionKey);
    seen.add(definitionKey);
    if (end !== undefined) {
      held.set(definitionKey, { definitionKey, ...end });
    }
    if (changedBy.length > 0) {
      named.add(definitionKey);
    }
  }
  return { held, seen, named };
}

function requireEveryDefinitionNamed({ seen, named }: Filled): void {
  const unnamed = [...seen].filter((definitionKey) => !named.has(definitionKey)).length;
  if (unnamed > 0) {
    throw new Error(
      `The names of definitions were filled with ${unnamed} definition whose facts give it no name; the store stays at the layout before`,
    );
  }
}

function requireOneHolderEach(held: readonly HeldName[]): void {
  const names = new Set(held.map((name) => JSON.stringify([name.playbookKey, nameKeyOf(name)])));
  if (names.size !== held.length) {
    throw new Error(
      `The names of definitions were filled with ${held.length - names.size} name held by two definitions of one playbook and type; the store stays at the layout before`,
    );
  }
}

function rowWritten(execute: StatementExecutor, { dialect }: LayoutDialect, row: HeldName): Promise<unknown> {
  const { definitionKey, playbookKey, definitionType, name, status, hasTriggers } = row;
  const triggers = dialect === 'postgresql' ? hasTriggers : Number(hasTriggers);
  return execute.command(
    SQL`INSERT INTO ${definitionNames} (playbook_key, definition_type, name, definition_key, status, has_triggers)
      VALUES (${playbookKey}, ${definitionType}, ${name}, ${definitionKey}, ${status}, ${triggers})`,
  );
}

async function filled(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  names: DefinitionNames,
  mostBytes: number,
): Promise<void> {
  let filling = nothingFilled;
  await inTurn(await streamsHoldingNames(execute, names), async (stream) => {
    await inTurn(pagesOf(await sizesIn(execute, dialect, names.types, stream), mostBytes), async (page) => {
      filling = filledAfter(names, filling, await messagesOf(execute, dialect, names.types, { stream, ...page }));
    });
  });
  requireEveryDefinitionNamed(filling);
  const rows = [...filling.held.values()];
  requireOneHolderEach(rows);
  await execute.command(SQL`DELETE FROM ${definitionNames}`);
  await inTurn(rows, (row) => rowWritten(execute, dialect, row));
}

export function definitionNamesFilledBy(names: DefinitionNames, mostBytes: number): StepInCode {
  return {
    inCode: async (execute, dialect) => {
      const tables = await namesFound(execute, dialect.tablesOfTheSchema());
      if (tables.includes('emt_streams')) {
        await filled(execute, dialect, { ...names, bounds: [] }, mostBytes);
      }
    },
  };
}
