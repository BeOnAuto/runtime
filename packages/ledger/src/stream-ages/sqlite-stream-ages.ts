import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { defaultPartition } from '../recorded/sqlite-parts.ts';
import type { KeptStreamAges } from './stream-ages-store.ts';

const AgeRows = Schema.Array(Schema.Struct({ age: Schema.Int }));

const PositionRows = Schema.Array(Schema.Struct({ position: Schema.Int }));

export function sqliteStreamAges(execute: SQLExecutor): KeptStreamAges {
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
    lastPositionOf: async (stream) => {
      const { rows } = await execute.query(
        SQL`SELECT CAST(stream_position AS INTEGER) AS position
          FROM emt_messages
          WHERE stream_id = ${stream} AND partition = ${defaultPartition} AND is_archived = FALSE
          ORDER BY stream_position DESC
          LIMIT 1`,
      );
      return Schema.decodeUnknownSync(PositionRows)(rows).at(0)?.position ?? 0;
    },
  };
}
