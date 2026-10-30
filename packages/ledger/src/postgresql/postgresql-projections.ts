import { SQL } from '@event-driven-io/dumbo';

import type { StatementExecutor } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { projectionPartsOf, type KeptTables } from '../projections/projection-parts.ts';
import { storedDataOf } from './json-text.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

const defaultPartition = 'emt:default';

const rowsInAWrite = 500;

const beforeEveryMessage = '0/0';

export const postgresqlProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname ~ ${`^${name}_[0-9]+$`} AND pg_table_is_visible(oid)`,
  columnTypes: { text: 'text', integer: 'bigint', boolean: 'boolean' },
  playbookIndexNulls: ' NULLS FIRST',
  asNumber: (expression) => `${expression}::float8`,
  streamsAfter: (after, count, kinds, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data ->> 'json')), 0)::float8 FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id
          AND m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after} AND s.stream_id ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[^/]+$'
        AND split_part(s.stream_id, '/', 4) IN (SELECT jsonb_array_elements_text(${JSON.stringify(kinds)}::jsonb))
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
  messagesInOrderAfter: (after, count, kinds, types) =>
    SQL`SELECT m.transaction_id::text || '/' || m.global_position::text AS point, m.stream_id AS stream,
        m.message_type AS type, m.message_data AS data, m.message_metadata AS metadata,
        m.stream_position::float8 AS position
      FROM emt_messages AS m
      WHERE (m.transaction_id, m.global_position)
          > (split_part(${after ?? beforeEveryMessage}, '/', 1)::xid8, split_part(${after ?? beforeEveryMessage}, '/', 2)::bigint)
        AND m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
        AND m.stream_id ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[^/]+$'
        AND split_part(m.stream_id, '/', 4) IN (SELECT jsonb_array_elements_text(${JSON.stringify(kinds)}::jsonb))
        AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ORDER BY m.transaction_id, m.global_position
      LIMIT ${count}`,
  rowsInAWrite: () => rowsInAWrite,
  filledData: storedDataOf,
  filledMetadata: (column) => column,
  appendedData: storedDataOf,
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
  };
}
