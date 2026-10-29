import { SQL } from '@event-driven-io/dumbo';
import { factTypesOf } from '@on.auto/operations';
import { Data, Result, Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from './layout-dialects.ts';

export type FactSchemaRead = Schema.ConstraintCodec<unknown, unknown>;

export interface UnreadableFact {
  readonly type: string;
  readonly position: string;
}

interface Refused {
  readonly unknown: readonly string[];
  readonly unreadable: readonly UnreadableFact[];
}

export class LedgerFactsRefused extends Data.TaggedError('ledger_facts_refused')<
  Refused & { readonly message: string }
> {}

interface StoredFact {
  readonly type: string;
  readonly data: unknown;
  readonly context: unknown;
}

export interface FactsRead {
  readonly types: ReadonlySet<string>;
  readonly reads: (fact: StoredFact) => boolean;
}

interface Reader {
  readonly types: ReadonlySet<string>;
  readonly decode: (fact: unknown) => Result.Result<unknown, unknown>;
}

export function factsReadBy(schemas: readonly FactSchemaRead[]): FactsRead {
  const readers: readonly Reader[] = schemas.map((schema) => ({
    types: new Set(factTypesOf(schema)),
    decode: Schema.decodeUnknownResult(Schema.toCodecJson(schema)),
  }));
  return {
    types: new Set(readers.flatMap(({ types }: Reader) => [...types])),
    reads: (fact) =>
      readers.some(({ types, decode }: Reader) => types.has(fact.type) && Result.isSuccess(decode(fact))),
  };
}

function typesNamed(unknown: readonly string[]): string {
  return `${unknown.length === 1 ? 'the type' : 'the types'} ${unknown.join(', ')}`;
}

function factsNamed(unreadable: readonly UnreadableFact[]): string {
  const named = unreadable.map(({ type, position }) => `${type} at position ${position}`).join(', ');
  return `${unreadable.length === 1 ? 'the fact' : 'the facts'} ${named}`;
}

function whatIsHeld({ unknown, unreadable }: Refused): string {
  return [
    ...(unknown.length === 0 ? [] : [`facts of ${typesNamed(unknown)}, which this server does not read`]),
    ...(unreadable.length === 0 ? [] : [`${factsNamed(unreadable)}, in a shape this server does not read`]),
  ].join(', and ');
}

function ledgerFactsRefused(refused: Refused): LedgerFactsRefused {
  return new LedgerFactsRefused({
    ...refused,
    message: `The ledger's database holds ${whatIsHeld(refused)}, so it was made by an earlier or a later release of the server than this one reads. A database a later release made wants that release or a later one, and one an earlier release made is not carried forward, so delete the local database and start the server again`,
  });
}

const messagesTable = 'emt_messages';

const newestFactOfEachType = SQL`SELECT m.message_type AS type, m.global_position AS position,
    m.message_data AS data, m.message_metadata AS metadata
  FROM emt_messages m
  JOIN (SELECT message_type, MAX(global_position) AS newest FROM emt_messages GROUP BY message_type) n
    ON m.message_type = n.message_type AND m.global_position = n.newest
  ORDER BY m.message_type`;

const NewestRows = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    position: Schema.Union([Schema.Number, Schema.String]),
    data: Schema.Unknown,
    metadata: Schema.Unknown,
  }),
);

type NewestRow = (typeof NewestRows.Type)[number];

function isRead(facts: FactsRead, dialect: LayoutDialect, { type, data, metadata }: NewestRow): boolean {
  return facts.reads({ type, data: dialect.storedData(data), context: dialect.storedMetadata(metadata) });
}

export async function requireTheFactsRead(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  tables: readonly string[],
  facts: FactsRead | undefined,
): Promise<void> {
  if (facts === undefined || !tables.includes(messagesTable)) {
    return;
  }
  const newest = Schema.decodeUnknownSync(NewestRows)((await execute.query(newestFactOfEachType)).rows);
  const unknown = newest.filter(({ type }) => !facts.types.has(type)).map(({ type }) => type);
  const unreadable = newest
    .filter((row) => facts.types.has(row.type) && !isRead(facts, dialect, row))
    .map(({ type, position }) => ({ type, position: String(position) }));
  if (unknown.length > 0 || unreadable.length > 0) {
    throw ledgerFactsRefused({ unknown, unreadable });
  }
}
