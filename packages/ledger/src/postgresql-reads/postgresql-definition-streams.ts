import { Schema } from 'effect';

import type { DefinitionStreamsStore } from '../event-store.ts';
import { definitionTypeOfStream } from './playbook-indexes.ts';
import { defaultPartition, type Query } from './recorded-parts.ts';

const StreamRows = Schema.Array(Schema.Struct({ stream: Schema.String, version: Schema.FiniteFromString }));

export const definitionStreamsStatement = `SELECT stream_id AS stream, stream_position::text AS version FROM emt_streams
  WHERE (${definitionTypeOfStream}) = $1 AND partition = $2 AND is_archived = FALSE
  ORDER BY stream_id`;

export function postgresqlDefinitionStreams(query: Query): DefinitionStreamsStore {
  return {
    definitionStreams: async (definitionType) =>
      Schema.decodeUnknownSync(StreamRows)(await query(definitionStreamsStatement, [definitionType, defaultPartition])),
  };
}
