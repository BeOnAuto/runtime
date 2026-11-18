import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { definitionNames } from '../definition-names/definition-names-table.ts';
import { definitionNamesReadOn, readOn } from '../definition-names/name-rows.ts';
import type { DefinitionNamesStore, DefinitionStreamsStore } from '../event-store.ts';
import { definitionTypeOfStream, playbookKeyOfStream } from '../recorded/sqlite-indexes.ts';
import { runIdsReadOn } from '../run-ids/run-id-reads.ts';
import { placedStreamsOf, type RunIdsStore } from './definition-reads.ts';

const defaultPartition = 'emt:default';

const StreamRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, version: Schema.Int, placed_in: Schema.NullOr(Schema.String) }),
);

export function definitionStreamsQuery(definitionType: string): SQL {
  return SQL`SELECT s.stream_id AS stream, s.stream_position AS version, n.playbook_key AS placed_in
    FROM emt_streams AS s LEFT JOIN ${definitionNames} AS n ON n.definition_key = ${playbookKeyOfStream}
    WHERE ${definitionTypeOfStream} = ${definitionType} AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
    ORDER BY s.stream_id`;
}

export function sqliteDefinitionReads(
  execute: SQLExecutor,
): DefinitionStreamsStore & DefinitionNamesStore & RunIdsStore {
  return {
    definitionStreams: async (definitionType) => {
      const { rows } = await execute.query(definitionStreamsQuery(definitionType));
      return placedStreamsOf(Schema.decodeUnknownSync(StreamRows)(rows));
    },
    ...definitionNamesReadOn(readOn(execute)),
    ...runIdsReadOn(readOn(execute)),
  };
}
