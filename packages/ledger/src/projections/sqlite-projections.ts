import { SQL } from '@event-driven-io/dumbo';
import type { StreamScope } from '@on.auto/operations';
import { Schema } from 'effect';

import { itemsInAStatement, mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { inTransactionOf, type TransactionalPool } from '../event-store.ts';
import { playbookKeyOfStream } from '../recorded/sqlite-indexes.ts';
import { type FoldedStreams, type MessageLane, type ProjectionDialect } from './projection-dialect.ts';
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

const columnsOfAMessage = SQL.plain(`CAST(global_position AS TEXT) AS point,
  printf('%020d', global_position) AS ordered, stream_id AS stream, message_type AS type,
  message_data AS data, message_metadata AS metadata, stream_position AS position`);

function typesIn(types: readonly string[]): SQL {
  return SQL`message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))`;
}

const keyOfALane: Readonly<Record<MessageLane['by'], ReturnType<typeof SQL.plain>>> = {
  stream: SQL.plain('stream_id'),
  prefix: playbookKeyOfStream,
};

interface LaneRead {
  readonly after: number;
  readonly count: number;
  readonly types: readonly string[];
}

function laneAfter({ by, key }: MessageLane, { after, count, types }: LaneRead): SQL {
  return SQL`SELECT ${columnsOfAMessage}
    FROM emt_messages
    WHERE ${keyOfALane[by]} = ${key} AND global_position > ${after} AND ${typesIn(types)}
      AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY global_position
    LIMIT ${count}`;
}

function inOrderAfter(after: number, count: number, folded: FoldedStreams, types: readonly string[]): SQL {
  return SQL`SELECT ${columnsOfAMessage}
    FROM emt_messages
    WHERE ${foldedBy('stream_id', folded)}
      AND global_position > ${after}
      AND ${typesIn(types)}
      AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY global_position
    LIMIT ${count}`;
}

const sqliteProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ${`${name}_*`}`,
  columnTypes: { text: 'TEXT', integer: 'INTEGER', boolean: 'INTEGER' },
  playbookIndexNulls: '',
  asNumber: (expression) => expression,
  streamsAfter: (after, count, folded, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data)), 0) FROM emt_messages AS m
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
  messagesInOrderAfter: (after, count, streams, types) => {
    const from = Number(after ?? '0');
    return streams.of === 'folded'
      ? inOrderAfter(from, count, streams.folded, types)
      : laneAfter(streams.lane, { after: from, count, types });
  },
  messageAt: (stream, position) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position AS position
      FROM emt_messages
      WHERE stream_id = ${stream} AND stream_position = ${position}
        AND partition = ${defaultPartition} AND is_archived = FALSE`,
  rowLocks: () => [],
  rowsInAWrite: (columns) =>
    itemsInAStatement({ mostBoundValues: mostValuesTheLedgerBindsOnSQLite, valuesEach: columns + 2 }),
  filledData: (column) => decodeText(column),
  filledMetadata: (column) => decodeText(column),
  appendedData: (stored) => stored,
  storedData: (data) => data,
  booleanOf: (value) => (value ? 1 : 0),
};

export function sqliteProjectionsOf(kept: KeptTables): ProjectionParts {
  return projectionPartsOf(sqliteProjectionDialect, kept);
}

export function preparedOn(prepare: ProjectionParts['prepare'], pool: TransactionalPool): Promise<void> {
  return prepare(pool.execute, inTransactionOf(pool));
}
