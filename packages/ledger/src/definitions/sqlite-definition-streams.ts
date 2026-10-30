import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { DefinitionStreamsStore } from '../event-store.ts';
import { definitionTypeOfStream } from '../recorded/sqlite-indexes.ts';

const defaultPartition = 'emt:default';

const StreamRows = Schema.Array(Schema.Struct({ stream: Schema.String, version: Schema.Int }));

export function definitionStreamsQuery(definitionType: string): SQL {
  return SQL`SELECT stream_id AS stream, stream_position AS version FROM emt_streams
    WHERE ${definitionTypeOfStream} = ${definitionType} AND partition = ${defaultPartition} AND is_archived = FALSE
    ORDER BY stream_id`;
}

export function sqliteDefinitionStreams(execute: SQLExecutor): DefinitionStreamsStore {
  return {
    definitionStreams: async (definitionType) => {
      const { rows } = await execute.query(definitionStreamsQuery(definitionType));
      return Schema.decodeUnknownSync(StreamRows)(rows);
    },
  };
}
