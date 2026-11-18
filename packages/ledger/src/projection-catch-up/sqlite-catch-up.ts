import { SQL } from '@event-driven-io/dumbo';

import { storedBytesOf } from '../recorded/sqlite-indexes.ts';
import type { CatchUpDialect } from './catch-up-dialect.ts';

const defaultPartition = 'emt:default';

function upTo(through: string | undefined): SQL {
  return through === undefined ? SQL.EMPTY : SQL` AND global_position <= ${Number(through)}`;
}

export const sqliteCatchUp: CatchUpDialect = {
  beforeEveryFact: '0',
  orderOf: (point) => point.padStart(20, '0'),
  window: ({ after, through, count }) =>
    SQL`SELECT CAST(global_position AS TEXT) AS point, stream_id AS stream, message_type AS type,
        ${SQL.plain(storedBytesOf())} AS size
      FROM emt_messages
      WHERE global_position > ${Number(after)}${upTo(through)}
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY global_position
      LIMIT ${count}`,
  factsAt: (points) =>
    SQL`SELECT CAST(global_position AS TEXT) AS point, printf('%020d', global_position) AS ordered,
        stream_id AS stream, message_type AS type, message_data AS data, message_metadata AS metadata,
        stream_position AS position
      FROM emt_messages
      WHERE global_position IN (SELECT value FROM json_each(${JSON.stringify(points.map(Number))}))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY global_position`,
};
