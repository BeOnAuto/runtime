import { SQL } from '@event-driven-io/dumbo';

import { sizedPositionsOf, type SizesAfter } from '../appends/stream-pages.ts';
import { inTransactionOn, type ContentConnections } from '../content/postgresql-content.ts';
import type { StatementExecutor } from '../event-store.ts';
import {
  columnsOfTheTable,
  dataBytesOf,
  playbookKeyOfStream,
  storedBytesOf,
} from '../postgresql-reads/playbook-indexes.ts';
import { postgresqlCatchUp } from '../projection-catch-up/postgresql-catch-up.ts';
import {
  type HeldRead,
  type HeldTypes,
  type MessageLane,
  type ProjectionDialect,
  type StreamsInOrder,
} from '../projections/projection-dialect.ts';
import { projectionPartsOf, type KeptTables } from '../projections/projection-parts.ts';
import { dataAsJsonText, storedDataOf } from './json-text.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

const defaultPartition = 'emt:default';

const rowsInAWrite = 500;

const beforeEveryMessage = '0/0';

const columnsOfAMessage = SQL`${SQL.plain(`m.transaction_id::text || '/' || m.global_position::text AS point,
  lpad(m.transaction_id::text, 20, '0') || '/' || lpad(m.global_position::text, 20, '0') AS ordered,
  m.stream_id AS stream, m.message_type AS type, m.message_data AS data, m.message_metadata AS metadata,
  m.stream_position::float8 AS position`)}`;

const columnsOfASize = SQL`${SQL.plain(`m.transaction_id::text || '/' || m.global_position::text AS point,
  ${storedBytesOf(columnsOfTheTable('m'))}::float8 AS size`)}`;

const columnsToSize = SQL.plain('m.transaction_id, m.global_position, m.stream_id, m.message_data, m.message_metadata');

function typesIn(types: readonly string[]): SQL {
  return SQL`m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))`;
}

function heldTypesIn({ holding, measured }: HeldTypes): SQL {
  return SQL`(${typesIn(holding)} OR (${typesIn(measured)} AND (m.message_metadata ->> 'payloadBytes') IS NOT NULL))`;
}

function pointsAfter(after: string | undefined): SQL {
  const point = after ?? beforeEveryMessage;
  return SQL`(m.transaction_id, m.global_position)
    > (split_part(${point}, '/', 1)::xid8, split_part(${point}, '/', 2)::bigint)`;
}

const keyOfALane: Readonly<Record<MessageLane['by'], ReturnType<typeof SQL.plain>>> = {
  stream: SQL.plain('m.stream_id'),
  prefix: SQL.plain(`(${playbookKeyOfStream})`),
};

interface LaneRead {
  readonly after: string | undefined;
  readonly count: number;
  readonly types: readonly string[] | HeldTypes;
  readonly sized?: boolean;
  readonly through?: string;
}

function upTo({ through }: LaneRead): SQL {
  return through === undefined
    ? SQL.EMPTY
    : SQL` AND (m.transaction_id, m.global_position)
      <= (split_part(${through}, '/', 1)::xid8, split_part(${through}, '/', 2)::bigint)`;
}

function limitOf({ count, through }: LaneRead): SQL {
  return through === undefined ? SQL`LIMIT ${count}` : SQL.EMPTY;
}

function selectedOf({ types }: LaneRead): SQL {
  return 'holding' in types ? heldTypesIn(types) : typesIn(types);
}

function keyLocked(table: string, prefix: string, key: string): readonly SQL[] {
  return [SQL`SELECT pg_advisory_xact_lock(hashtextextended(${`${table}:${prefix}${key}`}, 0))`];
}

function whichOf(streams: StreamsInOrder): SQL {
  if (streams.of === 'lane') {
    const { by, key } = streams.lane;
    return SQL`${keyOfALane[by]} = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([key])}::jsonb))) AND `;
  }
  return SQL.EMPTY;
}

function orderOf(streams: StreamsInOrder): SQL {
  return streams.of === 'lane'
    ? SQL`${keyOfALane[streams.lane.by]}, m.transaction_id, m.global_position`
    : SQL`m.transaction_id, m.global_position`;
}

function streamsInOrder(read: LaneRead, streams: StreamsInOrder): SQL {
  const order = orderOf(streams);
  const rows = SQL`SELECT ${read.sized === true ? columnsToSize : columnsOfAMessage}
    FROM emt_messages AS m
    WHERE ${whichOf(streams)}${pointsAfter(read.after)}${upTo(read)} AND ${selectedOf(read)}
      AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
    ORDER BY ${order}
    ${limitOf(read)}`;
  return read.sized === true ? SQL`SELECT ${columnsOfASize} FROM (${rows}) AS m ORDER BY ${order}` : rows;
}

function heldInOrder({ after, count, streams, types }: HeldRead, sized: boolean, through?: string): SQL {
  return streamsInOrder({ after, count, types, sized, ...(through === undefined ? {} : { through }) }, streams);
}

export const postgresqlProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname ~ ${`^${name}_[0-9]+$`} AND pg_table_is_visible(oid)`,
  columnTypes: { text: 'text', integer: 'bigint', boolean: 'boolean' },
  playbookIndexNulls: ' NULLS FIRST',
  asNumber: (expression) => `${expression}::float8`,
  messagesInOrderAfter: (after, count, streams, types) => streamsInOrder({ after, count, types }, streams),
  heldMessagesThrough: (read, through) => heldInOrder(read, false, through),
  heldSizesInOrderAfter: (read) => heldInOrder(read, true),
  messageAt: (stream, position) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position::float8 AS position
      FROM emt_messages
      WHERE stream_id = ${stream} AND stream_position = ${position}
        AND partition = ${defaultPartition} AND is_archived = FALSE`,
  keyLocks: keyLocked,
  rowLocks: (table, prefix, key) => [
    ...keyLocked(table, prefix, key),
    SQL`SELECT 1 FROM ${SQL.plain(table)} WHERE playbook_key = ${prefix} AND row_key = ${key} FOR UPDATE`,
  ],
  rowsInAWrite: () => rowsInAWrite,
  filledData: storedDataOf,
  filledMetadata: (column) => column,
  appendedData: storedDataOf,
  storedData: dataAsJsonText.stored,
  metadataMeasured: (payloadBytes) =>
    payloadBytes === undefined
      ? SQL`message_metadata - 'payloadBytes'`
      : SQL`jsonb_set(message_metadata, '{payloadBytes}', to_jsonb(${payloadBytes}::bigint))`,
  booleanOf: (value) => value,
  listed: (values) => SQL`SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) AS value`,
  storedBytesOfMessage: storedBytesOf(columnsOfTheTable('m')),
  forUpdate: ' FOR UPDATE',
  catchUp: postgresqlCatchUp,
};

export function postgresqlSizesAfter(
  query: (text: string, values: readonly unknown[]) => Promise<readonly unknown[]>,
): SizesAfter {
  return async (stream, after, count) =>
    sizedPositionsOf(
      await query(
        `SELECT m.stream_position::float8 AS position, ${dataBytesOf(columnsOfTheTable('m'))}::float8 AS size
          FROM emt_messages AS m
          WHERE m.stream_id = $1 AND m.stream_position > $2 AND m.partition = $3 AND m.is_archived = FALSE
          ORDER BY m.stream_position
          LIMIT $4`,
        [stream, after, defaultPartition, count],
      ),
    );
}

export function postgresqlProjectionsOf(kept: KeptTables) {
  const parts = projectionPartsOf(postgresqlProjectionDialect, kept);
  return {
    ...parts,
    afterTheSchema: async ({ execute }: { readonly execute: StatementExecutor }): Promise<void> => {
      await postgresqlSchemaCreated(execute);
      await parts.prepare(execute, (work) => work(execute));
    },
    holdsOn: (connections: ContentConnections, read: (sql: SQL) => Promise<readonly unknown[]>) => ({
      unlessHeld: parts.references.unlessHeldOn(inTransactionOn(connections)),
      heldHeads: parts.references.heldHeadsOn(read),
    }),
    readerOnThePool: (pool: ContentConnections, query: (sql: SQL) => Promise<readonly unknown[]>) =>
      parts.readerOn({ query, command: query, inTransaction: inTransactionOn(pool) }),
    caughtUpOn: (pool: ContentConnections): Promise<void> => parts.caughtUp(inTransactionOn(pool)),
  };
}
