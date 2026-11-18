import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { sizedPositionsOf, type SizesAfter } from '../appends/stream-pages.ts';
import { itemsInAStatement, mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { inTransactionOf, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import { sqliteCatchUp } from '../projection-catch-up/sqlite-catch-up.ts';
import { dataBytesOf, playbookKeyOfStream, storedBytesOf } from '../recorded/sqlite-indexes.ts';
import {
  type HeldRead,
  type HeldTypes,
  type MessageLane,
  type ProjectionDialect,
  type StreamsInOrder,
} from './projection-dialect.ts';
import { projectionPartsOf, type KeptTables, type ProjectionParts } from './projection-parts.ts';

const defaultPartition = 'emt:default';

const decodeText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const columnsOfAMessage = SQL`${SQL.plain(`CAST(global_position AS TEXT) AS point,
  printf('%020d', global_position) AS ordered, stream_id AS stream, message_type AS type,
  message_data AS data, message_metadata AS metadata, stream_position AS position`)}`;

const columnsOfASize = SQL`${SQL.plain(`CAST(global_position AS TEXT) AS point, ${storedBytesOf()} AS size`)}`;

function typesIn(types: readonly string[]): SQL {
  return SQL`message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))`;
}

function heldTypesIn({ holding, measured }: HeldTypes): SQL {
  return SQL`(${typesIn(holding)} OR (${typesIn(measured)}
    AND json_extract(message_metadata, '$.payloadBytes') IS NOT NULL))`;
}

const keyOfALane: Readonly<Record<MessageLane['by'], ReturnType<typeof SQL.plain>>> = {
  stream: SQL.plain('stream_id'),
  prefix: playbookKeyOfStream,
};

interface LaneRead {
  readonly after: number;
  readonly count: number;
  readonly types: readonly string[] | HeldTypes;
  readonly sized?: boolean;
  readonly through?: number;
}

function selectedOf({ types }: LaneRead): SQL {
  return 'holding' in types ? heldTypesIn(types) : typesIn(types);
}

function columnsOf({ sized }: LaneRead): SQL {
  return sized === true ? columnsOfASize : columnsOfAMessage;
}

function upTo({ through }: LaneRead): SQL {
  return through === undefined ? SQL.EMPTY : SQL` AND global_position <= ${through}`;
}

function limitOf({ count, through }: LaneRead): SQL {
  return through === undefined ? SQL`LIMIT ${count}` : SQL.EMPTY;
}

function laneAfter({ by, key }: MessageLane, read: LaneRead): SQL {
  return SQL`SELECT ${columnsOf(read)}
    FROM emt_messages
    WHERE ${keyOfALane[by]} = ${key} AND global_position > ${read.after}${upTo(read)} AND ${selectedOf(read)}
      AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY global_position
    ${limitOf(read)}`;
}

function inOrderAfter(read: LaneRead): SQL {
  return SQL`SELECT ${columnsOf(read)}
    FROM emt_messages
    WHERE global_position > ${read.after}${upTo(read)}
      AND ${selectedOf(read)}
      AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY global_position
    ${limitOf(read)}`;
}

function streamsInOrder(read: LaneRead, streams: StreamsInOrder): SQL {
  if (streams.of === 'lane') {
    return laneAfter(streams.lane, read);
  }
  return inOrderAfter(read);
}

function heldInOrder({ after, count, streams, types }: HeldRead, sized: boolean, through?: string): SQL {
  return streamsInOrder(
    {
      after: Number(after ?? '0'),
      count,
      types,
      sized,
      ...(through === undefined ? {} : { through: Number(through) }),
    },
    streams,
  );
}

const sqliteProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ${`${name}_*`}`,
  columnTypes: { text: 'TEXT', integer: 'INTEGER', boolean: 'INTEGER' },
  playbookIndexNulls: '',
  asNumber: (expression) => expression,
  messagesInOrderAfter: (after, count, streams, types) =>
    streamsInOrder({ after: Number(after ?? '0'), count, types }, streams),
  heldMessagesThrough: (read, through) => heldInOrder(read, false, through),
  heldSizesInOrderAfter: (read) => heldInOrder(read, true),
  messageAt: (stream, position) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position AS position
      FROM emt_messages
      WHERE stream_id = ${stream} AND stream_position = ${position}
        AND partition = ${defaultPartition} AND is_archived = FALSE`,
  keyLocks: () => [],
  rowLocks: () => [],
  rowsInAWrite: (columns) =>
    itemsInAStatement({ mostBoundValues: mostValuesTheLedgerBindsOnSQLite, valuesEach: columns + 2 }),
  filledData: (column) => decodeText(column),
  filledMetadata: (column) => decodeText(column),
  appendedData: (stored) => stored,
  storedData: (data) => data,
  metadataMeasured: (payloadBytes) =>
    payloadBytes === undefined
      ? SQL`json_remove(message_metadata, '$.payloadBytes')`
      : SQL`json_set(message_metadata, '$.payloadBytes', ${payloadBytes})`,
  booleanOf: (value) => (value ? 1 : 0),
  listed: (values) => SQL`SELECT value FROM json_each(${JSON.stringify(values)})`,
  storedBytesOfMessage: storedBytesOf('m'),
  forUpdate: '',
  catchUp: sqliteCatchUp,
};

export function sqliteSizesAfter(execute: StatementExecutor): SizesAfter {
  return async (stream, after, count) => {
    const { rows } = await execute.query(
      SQL`SELECT stream_position AS position, ${SQL.plain(dataBytesOf())} AS size FROM emt_messages
        WHERE stream_id = ${stream} AND stream_position > ${after}
          AND partition = ${defaultPartition} AND is_archived = FALSE
        ORDER BY stream_position
        LIMIT ${count}`,
    );
    return sizedPositionsOf(rows);
  };
}

export function sqliteProjectionsOf(kept: KeptTables): ProjectionParts {
  return projectionPartsOf(sqliteProjectionDialect, kept);
}

export async function preparedOn(
  { prepare, caughtUp }: Pick<ProjectionParts, 'prepare' | 'caughtUp'>,
  pool: TransactionalPool,
): Promise<void> {
  const inTransaction = inTransactionOf(pool);
  await prepare(pool.execute, inTransaction);
  await caughtUp(inTransaction);
}
