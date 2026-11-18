import { SQL } from '@event-driven-io/dumbo';

import { columnsOfTheTable, storedBytesOf } from '../postgresql-reads/playbook-indexes.ts';
import type { CatchUpDialect } from './catch-up-dialect.ts';

const defaultPartition = 'emt:default';

function placeOf(point: string): SQL {
  return SQL`(split_part(${point}, '/', 1)::xid8, split_part(${point}, '/', 2)::bigint)`;
}

function upTo(through: string | undefined): SQL {
  return through === undefined ? SQL.EMPTY : SQL` AND (m.transaction_id, m.global_position) <= ${placeOf(through)}`;
}

const pointOfAFact = SQL.plain(`m.transaction_id::text || '/' || m.global_position::text AS point`);

const sizeOfAFact = SQL.plain(`${storedBytesOf(columnsOfTheTable('m'))}::float8 AS size`);

const columnsOfAFact = SQL.plain(`lpad(m.transaction_id::text, 20, '0') || '/' || lpad(m.global_position::text, 20, '0')
    AS ordered, m.stream_id AS stream, m.message_type AS type, m.message_data AS data,
    m.message_metadata AS metadata, m.stream_position::float8 AS position`);

export const postgresqlCatchUp: CatchUpDialect = {
  beforeEveryFact: '0/0',
  orderOf: (point) => {
    const [transaction = '', position = ''] = point.split('/');
    return `${transaction.padStart(20, '0')}/${position.padStart(20, '0')}`;
  },
  window: ({ after, through, count }) =>
    SQL`SELECT ${pointOfAFact}, m.stream_id AS stream, m.message_type AS type, ${sizeOfAFact}
      FROM (
        SELECT m.transaction_id, m.global_position, m.stream_id, m.message_type, m.message_data
        FROM emt_messages AS m
        WHERE (m.transaction_id, m.global_position) > ${placeOf(after)}${upTo(through)}
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
        ORDER BY m.transaction_id, m.global_position
        LIMIT ${count}
      ) AS m
      ORDER BY m.transaction_id, m.global_position`,
  factsAt: (points) =>
    SQL`SELECT ${pointOfAFact}, ${columnsOfAFact}
      FROM emt_messages AS m
      WHERE (m.transaction_id, m.global_position) IN (
          SELECT split_part(taken.point, '/', 1)::xid8, split_part(taken.point, '/', 2)::bigint
          FROM jsonb_array_elements_text(${JSON.stringify(points)}::jsonb) AS taken (point)
        )
        AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ORDER BY m.transaction_id, m.global_position`,
};
