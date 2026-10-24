import { Schema } from 'effect';

import type { StreamAgesStore } from '../event-store.ts';
import { defaultPartition, type Query } from '../postgresql-reads/recorded-parts.ts';

const AgeRows = Schema.Array(Schema.Struct({ age: Schema.FiniteFromString }));

export const streamAgeStatement = `SELECT (EXTRACT(EPOCH FROM (now() - created)) * 1000)::bigint::text AS age
  FROM emt_messages
  WHERE stream_id = $1 AND partition = $2 AND is_archived = FALSE
  ORDER BY stream_position DESC
  LIMIT 1`;

export function postgresqlStreamAges(query: Query): StreamAgesStore {
  return {
    ageOfLastAppend: async (stream) =>
      Schema.decodeUnknownSync(AgeRows)(await query(streamAgeStatement, [stream, defaultPartition])).at(0)?.age ??
      Number.POSITIVE_INFINITY,
  };
}
