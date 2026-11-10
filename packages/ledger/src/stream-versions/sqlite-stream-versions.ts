import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StreamVersionsStore } from '../event-store.ts';
import { defaultPartition } from '../recorded/sqlite-parts.ts';

const VersionRows = Schema.Array(Schema.Struct({ version: Schema.Int }));

export function sqliteStreamVersions(execute: SQLExecutor): StreamVersionsStore {
  return {
    versionOf: async (stream) => {
      const { rows } = await execute.query(
        SQL`SELECT stream_position AS version FROM emt_streams
          WHERE stream_id = ${stream} AND partition = ${defaultPartition} AND is_archived = FALSE`,
      );
      return Schema.decodeUnknownSync(VersionRows)(rows).at(0)?.version ?? 0;
    },
  };
}
