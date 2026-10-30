import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { inTransactionOf, type TransactionalPool } from '../event-store.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { projectionPartsOf, type KeptTables, type ProjectionParts } from './projection-parts.ts';

const defaultPartition = 'emt:default';

const mostParameters = 100;

const decodeText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const sqliteProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ${`${name}_*`}`,
  columnTypes: { text: 'TEXT', integer: 'INTEGER', boolean: 'INTEGER' },
  playbookIndexNulls: '',
  asNumber: (expression) => expression,
  streamsAfter: (after, count, kinds, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data)), 0) FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id AND m.message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after}
        AND EXISTS (SELECT 1 FROM json_each(${JSON.stringify(kinds)}) AS k WHERE s.stream_id GLOB '*/*/*/' || k.value || '/*')
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
  messagesInOrderAfter: (after, count, kinds, types) =>
    SQL`SELECT CAST(m.global_position AS TEXT) AS point, m.stream_id AS stream, m.message_type AS type,
        m.message_data AS data, m.message_metadata AS metadata, m.stream_position AS position
      FROM emt_messages AS m
      WHERE m.global_position > ${Number(after ?? '0')}
        AND m.message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
        AND EXISTS (SELECT 1 FROM json_each(${JSON.stringify(kinds)}) AS k WHERE m.stream_id GLOB '*/*/*/' || k.value || '/*')
        AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ORDER BY m.global_position
      LIMIT ${count}`,
  rowsInAWrite: (columns) => Math.max(1, Math.floor(mostParameters / (columns + 2))),
  filledData: (column) => decodeText(column),
  filledMetadata: (column) => decodeText(column),
  appendedData: (stored) => stored,
  booleanOf: (value) => (value ? 1 : 0),
};

export function sqliteProjectionsOf(kept: KeptTables): ProjectionParts {
  return projectionPartsOf(sqliteProjectionDialect, kept);
}

export function preparedOn(prepare: ProjectionParts['prepare'], pool: TransactionalPool): Promise<void> {
  return prepare(pool.execute, inTransactionOf(pool));
}
