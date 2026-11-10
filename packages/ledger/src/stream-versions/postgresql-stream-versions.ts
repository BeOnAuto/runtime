import { Schema } from 'effect';

import type { StreamVersionsStore } from '../event-store.ts';
import { defaultPartition, type Query } from '../postgresql-reads/recorded-parts.ts';

const VersionRows = Schema.Array(Schema.Struct({ version: Schema.FiniteFromString }));

export const streamVersionStatement = `SELECT stream_position::text AS version FROM emt_streams
  WHERE stream_id = $1 AND partition = $2 AND is_archived = FALSE`;

export function postgresqlStreamVersions(query: Query): StreamVersionsStore {
  return {
    versionOf: async (stream) =>
      Schema.decodeUnknownSync(VersionRows)(await query(streamVersionStatement, [stream, defaultPartition])).at(0)
        ?.version ?? 0,
  };
}
