import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { definitionNames } from '../definition-names/definition-names-table.ts';
import { definitionNamesReadOn, readOn } from '../definition-names/name-rows.ts';
import type { DefinitionNamesStore, DefinitionStreamsStore, OrgStreamsStore } from '../event-store.ts';
import { definitionTypeOfStream, orgOfStream, playbookKeyOfStream } from '../recorded/sqlite-indexes.ts';
import { runIdsReadOn } from '../run-ids/run-id-reads.ts';
import { placedStreamsOf, type RunIdsStore } from './definition-reads.ts';

const defaultPartition = 'emt:default';

const StreamRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, version: Schema.Int, placed_in: Schema.NullOr(Schema.String) }),
);

const OrgStreamRows = Schema.Array(Schema.Struct({ org: Schema.String, version: Schema.Int }));

export function definitionStreamsQuery(definitionType: string): SQL {
  return SQL`SELECT s.stream_id AS stream, s.stream_position AS version, n.playbook_key AS placed_in
    FROM emt_streams AS s LEFT JOIN ${definitionNames} AS n ON n.definition_key = ${playbookKeyOfStream}
    WHERE ${definitionTypeOfStream} = ${definitionType} AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
    ORDER BY s.stream_id`;
}

export function orgStreamsQuery(name: string): SQL {
  return SQL`WITH RECURSIVE orgs (org) AS (
      SELECT (SELECT min(${orgOfStream}) FROM emt_messages)
      UNION ALL
      SELECT (SELECT min(${orgOfStream}) FROM emt_messages WHERE ${orgOfStream} > orgs.org) FROM orgs
      WHERE orgs.org IS NOT NULL
    )
    SELECT orgs.org AS org, s.stream_position AS version
    FROM orgs JOIN emt_streams AS s ON s.stream_id = 'org/' || orgs.org || '/' || ${name}
    WHERE s.partition = ${defaultPartition} AND s.is_archived = FALSE
    ORDER BY orgs.org`;
}

export function sqliteDefinitionReads(
  execute: SQLExecutor,
): DefinitionStreamsStore & OrgStreamsStore & DefinitionNamesStore & RunIdsStore {
  return {
    definitionStreams: async (definitionType) => {
      const { rows } = await execute.query(definitionStreamsQuery(definitionType));
      return placedStreamsOf(Schema.decodeUnknownSync(StreamRows)(rows));
    },
    orgStreams: async (name) => {
      const { rows } = await execute.query(orgStreamsQuery(name));
      return Schema.decodeUnknownSync(OrgStreamRows)(rows);
    },
    ...definitionNamesReadOn(readOn(execute)),
    ...runIdsReadOn(readOn(execute)),
  };
}
