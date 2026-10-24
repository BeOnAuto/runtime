import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StreamAgesStore } from '../event-store.ts';
import { defaultPartition } from '../recorded/sqlite-parts.ts';

const AgeRows = Schema.Array(Schema.Struct({ age: Schema.Int }));

export function sqliteStreamAges(execute: SQLExecutor): StreamAgesStore {
  return {
    ageOfLastAppend: async (stream) => {
      const { rows } = await execute.query(
        SQL`SELECT CAST(ROUND((julianday('now') - julianday(created)) * 86400000) AS INTEGER) AS age
          FROM emt_messages
          WHERE stream_id = ${stream} AND partition = ${defaultPartition} AND is_archived = FALSE
          ORDER BY stream_position DESC
          LIMIT 1`,
      );
      return Schema.decodeUnknownSync(AgeRows)(rows).at(0)?.age ?? Number.POSITIVE_INFINITY;
    },
  };
}
