import { SQL } from '@event-driven-io/dumbo';
import type { StreamScope } from '@on.auto/operations';
import { Schema } from 'effect';

import { sizedPositionsOf, type SizesAfter } from '../appends/stream-pages.ts';
import { itemsInAStatement, mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { inTransactionOf, type StatementExecutor, type TransactionalPool } from '../event-store.ts';
import { dataBytesOf, playbookKeyOfStream, storedBytesOf } from '../recorded/sqlite-indexes.ts';
import {
  type FoldedStreams,
  type HeldRead,
  type HeldTypes,
  type MessageLane,
  type ProjectionDialect,
  type StreamsInOrder,
} from './projection-dialect.ts';
import { projectionPartsOf, type KeptTables, type ProjectionParts } from './projection-parts.ts';

const defaultPartition = 'emt:default';

const decodeText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const streamsOfAKind: Readonly<Record<StreamScope, (kind: string) => string>> = {
  playbook: (kind) => `*/*/*/${kind}/*`,
  org: (kind) => `org/*/${kind}/*`,
};

function foldedBy(column: string, { scopes, kinds }: FoldedStreams): SQL {
  const patterns = scopes.flatMap((scope) => kinds.map((kind) => streamsOfAKind[scope](kind)));
  return SQL`EXISTS (SELECT 1 FROM json_each(${JSON.stringify(patterns)}) AS k WHERE ${SQL.plain(column)} GLOB k.value)`;
}

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

function inOrderAfter(read: LaneRead, folded?: FoldedStreams): SQL {
  const ofTheStreams = folded === undefined ? SQL.EMPTY : SQL`${foldedBy('stream_id', folded)} AND `;
  return SQL`SELECT ${columnsOf(read)}
    FROM emt_messages
    WHERE ${ofTheStreams}global_position > ${read.after}${upTo(read)}
      AND ${selectedOf(read)}
      AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY global_position
    ${limitOf(read)}`;
}

function streamsInOrder(read: LaneRead, streams: StreamsInOrder): SQL {
  if (streams.of === 'lane') {
    return laneAfter(streams.lane, read);
  }
  return inOrderAfter(read, streams.of === 'folded' ? streams.folded : undefined);
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
  streamsAfter: (after, count, folded, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(${SQL.plain(storedBytesOf('m'))}), 0) FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id AND m.message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after}
        AND ${foldedBy('s.stream_id', folded)}
        AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
      ORDER BY s.stream_id
      LIMIT ${count}`,
  messagesOf: (streams, types) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position AS position
      FROM emt_messages
      WHERE stream_id IN (SELECT value FROM json_each(${JSON.stringify(streams)}))
        AND message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id, stream_position`,
  messagesInOrderAfter: (after, count, streams, types) =>
    streamsInOrder({ after: Number(after ?? '0'), count, types }, streams),
  sizesInOrderAfter: (after, count, streams, types) =>
    streamsInOrder({ after: Number(after ?? '0'), count, types, sized: true }, streams),
  messagesInOrderThrough: (after, through, streams, types) =>
    streamsInOrder({ after: Number(after ?? '0'), count: 0, types, through: Number(through) }, streams),
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

export function preparedOn(prepare: ProjectionParts['prepare'], pool: TransactionalPool): Promise<void> {
  return prepare(pool.execute, inTransactionOf(pool));
}
