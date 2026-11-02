import { SQL } from '@event-driven-io/dumbo';
import type { StreamScope } from '@on.auto/operations';

import { inTransactionOn, type ContentConnections } from '../content/postgresql-content.ts';
import type { StatementExecutor } from '../event-store.ts';
import { playbookKeyOfStream } from '../postgresql-reads/playbook-indexes.ts';
import {
  type FoldedStreams,
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

const streamsOfAScope: Readonly<Record<StreamScope, { readonly name: string; readonly kindAt: number }>> = {
  playbook: { name: '^[^/]+/[^/]+/[^/]+/[^/]+/[^/]+$', kindAt: 4 },
  org: { name: '^org/[^/]+/[^/]+/[^/]+$', kindAt: 3 },
};

function foldedBy(column: string, { scopes, kinds }: FoldedStreams): SQL {
  const stream = SQL.plain(column);
  const ofEachScope = scopes.map((scope) => {
    const { name, kindAt } = streamsOfAScope[scope];
    return SQL`(${stream} ~ ${SQL.plain(`'${name}'`)} AND split_part(${stream}, '/', ${SQL.plain(String(kindAt))})
      IN (SELECT jsonb_array_elements_text(${JSON.stringify(kinds)}::jsonb)))`;
  });
  return SQL`(${SQL.merge(ofEachScope, ' OR ')})`;
}

const columnsOfAMessage = SQL.plain(`m.transaction_id::text || '/' || m.global_position::text AS point,
  lpad(m.transaction_id::text, 20, '0') || '/' || lpad(m.global_position::text, 20, '0') AS ordered,
  m.stream_id AS stream, m.message_type AS type, m.message_data AS data, m.message_metadata AS metadata,
  m.stream_position::float8 AS position`);

function typesIn(types: readonly string[]): SQL {
  return SQL`m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))`;
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
  readonly types: readonly string[];
}

function laneAfter({ by, key }: MessageLane, { after, count, types }: LaneRead): SQL {
  const ofTheLane = keyOfALane[by];
  return SQL`SELECT ${columnsOfAMessage}
    FROM emt_messages AS m
    WHERE ${ofTheLane} = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify([key])}::jsonb)))
      AND ${pointsAfter(after)} AND ${typesIn(types)}
      AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
    ORDER BY ${ofTheLane}, m.transaction_id, m.global_position
    LIMIT ${count}`;
}

function inOrderAfter(read: LaneRead, folded?: FoldedStreams): SQL {
  const ofTheStreams = folded === undefined ? SQL.EMPTY : SQL`${foldedBy('m.stream_id', folded)} AND `;
  return SQL`SELECT ${columnsOfAMessage}
    FROM emt_messages AS m
    WHERE ${ofTheStreams}${pointsAfter(read.after)}
      AND ${typesIn(read.types)}
      AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
    ORDER BY m.transaction_id, m.global_position
    LIMIT ${read.count}`;
}

function keyLocked(table: string, prefix: string, key: string): readonly SQL[] {
  return [SQL`SELECT pg_advisory_xact_lock(hashtextextended(${`${table}:${prefix}${key}`}, 0))`];
}

function streamsInOrder(read: LaneRead, streams: StreamsInOrder): SQL {
  if (streams.of === 'lane') {
    return laneAfter(streams.lane, read);
  }
  return inOrderAfter(read, streams.of === 'folded' ? streams.folded : undefined);
}

export const postgresqlProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname ~ ${`^${name}_[0-9]+$`} AND pg_table_is_visible(oid)`,
  columnTypes: { text: 'text', integer: 'bigint', boolean: 'boolean' },
  playbookIndexNulls: ' NULLS FIRST',
  asNumber: (expression) => `${expression}::float8`,
  streamsAfter: (after, count, folded, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data ->> 'json')), 0)::float8 FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id
          AND m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after} AND ${foldedBy('s.stream_id', folded)}
        AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
      ORDER BY s.stream_id
      LIMIT ${count}`,
  messagesOf: (streams, types) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position::float8 AS position
      FROM emt_messages
      WHERE stream_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(streams)}::jsonb))
        AND message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id, stream_position`,
  messagesInOrderAfter: (after, count, streams, types) => streamsInOrder({ after, count, types }, streams),
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
  booleanOf: (value) => value,
};

export function postgresqlProjectionsOf(kept: KeptTables) {
  const parts = projectionPartsOf(postgresqlProjectionDialect, kept);
  return {
    ...parts,
    afterTheSchema: async ({ execute }: { readonly execute: StatementExecutor }): Promise<void> => {
      await postgresqlSchemaCreated(execute);
      await parts.prepare(execute, (work) => work(execute));
    },
    unlessHeldOn: (connections: ContentConnections) => parts.references.unlessHeldOn(inTransactionOn(connections)),
  };
}
