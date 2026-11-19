import { Schema } from 'effect';

import { definitionNamesTableName } from '../definition-names/definition-names-table.ts';
import { definitionNamesReadOn } from '../definition-names/name-rows.ts';
import { placedStreamsOf, type RunIdsStore } from '../definitions/definition-reads.ts';
import type { DefinitionNamesStore, DefinitionStreamsStore, OrgStreamsStore } from '../event-store.ts';
import { runIdsReadOn } from '../run-ids/run-id-reads.ts';
import { definitionTypeOfStream, orgOfStream, playbookKeyOfStream } from './playbook-indexes.ts';
import { defaultPartition, formattedFor, type Query } from './recorded-parts.ts';

const StreamRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, version: Schema.FiniteFromString, placed_in: Schema.NullOr(Schema.String) }),
);

const OrgStreamRows = Schema.Array(Schema.Struct({ org: Schema.String, version: Schema.FiniteFromString }));

export const definitionStreamsStatement = `SELECT s.stream_id AS stream, s.stream_position::text AS version,
  n.playbook_key AS placed_in
  FROM emt_streams AS s LEFT JOIN ${definitionNamesTableName} AS n ON n.definition_key = (${playbookKeyOfStream})
  WHERE (${definitionTypeOfStream}) = $1 AND s.partition = $2 AND s.is_archived = FALSE
  ORDER BY s.stream_id`;

export const orgStreamsStatement = `WITH RECURSIVE orgs (org) AS (
    SELECT min(${orgOfStream}) FROM emt_messages
    UNION ALL
    SELECT (SELECT min(${orgOfStream}) FROM emt_messages WHERE (${orgOfStream}) > orgs.org) FROM orgs
    WHERE orgs.org IS NOT NULL
  )
  SELECT orgs.org AS org, s.stream_position::text AS version
  FROM orgs JOIN emt_streams AS s ON s.stream_id = 'org/' || orgs.org || '/' || $1
  WHERE s.partition = $2 AND s.is_archived = FALSE
  ORDER BY orgs.org`;

export function postgresqlDefinitionReads(
  query: Query,
): DefinitionStreamsStore & OrgStreamsStore & DefinitionNamesStore & RunIdsStore {
  return {
    definitionStreams: async (definitionType) =>
      placedStreamsOf(
        Schema.decodeUnknownSync(StreamRows)(
          await query(definitionStreamsStatement, [definitionType, defaultPartition]),
        ),
      ),
    orgStreams: async (name) =>
      Schema.decodeUnknownSync(OrgStreamRows)(await query(orgStreamsStatement, [name, defaultPartition])),
    ...definitionNamesReadOn(formattedFor(query)),
    ...runIdsReadOn(formattedFor(query)),
  };
}
