import { definitionStreamsStatement, orgStreamsStatement } from './postgresql-definition-reads.ts';

export const definitionStreamsPlan = {
  explained: `EXPLAIN ${definitionStreamsStatement}`,
  values: ['page', 'emt:default'],
  throughTheIndex: `Index Cond: ("substring"(stream_id, '^(?:[^/]*/){3}definitions/([^/]+)$'::text) = `,
};

const theOrgOfAStream = `(\nCASE\n    WHEN (strpos(substr(stream_id, (strpos(stream_id, '/'::text) + 1)), '/'::text) > 0) THEN split_part(stream_id, '/'::text, 2)\n    ELSE NULL::text\nEND)`;

const theOrgInAPlan =
  "CASE WHEN (strpos(substr(stream_id, (strpos(stream_id, '/'::text) + 1)), '/'::text) > 0) THEN split_part(stream_id, '/'::text, 2) ELSE NULL::text END";

export const orgStreamsPlan = {
  explained: `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, BUFFERS OFF, SUMMARY OFF) ${orgStreamsStatement}`,
  values: ['connections', 'emt:default'],
  ledgerOfManyOrgs: `WITH messages AS (
      INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata, message_schema_version,
        message_type, message_id, transaction_id)
      SELECT CASE WHEN run = 0 THEN 'org/org-' || org || '/connections' ELSE 'playbook/org-' || org || '/alpha/runs/' || run END,
        1, '{}'::jsonb, '{}'::jsonb, '1', 'noted', 'message-' || org || '-' || run, pg_current_xact_id()
      FROM generate_series(1, 20) AS org, generate_series(0, 250) AS run
      RETURNING stream_id
    )
    INSERT INTO emt_streams (stream_id, stream_position, stream_type, stream_metadata)
    SELECT stream_id, 1, 'noted', '{}'::jsonb FROM messages`,
  theNextOrg: `${theOrgInAPlan} > `,
  throughTheStreamsKey: 'Index Cond: ((stream_id = ',
};

export const thePlaybookIndexes = [
  {
    indexname: 'ledger_definition_streams',
    indexdef: `CREATE INDEX ledger_definition_streams ON ONLY public.emt_streams USING btree ("substring"(stream_id, '^(?:[^/]*/){3}definitions/([^/]+)$'::text)) WHERE ("substring"(stream_id, '^(?:[^/]*/){3}definitions/([^/]+)$'::text) IS NOT NULL)`,
  },
  {
    indexname: 'ledger_first_messages_by_kind',
    indexdef: `CREATE INDEX ledger_first_messages_by_kind ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){4}'::text), stream_position, transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_org',
    indexdef: `CREATE INDEX ledger_messages_by_org ON ONLY public.emt_messages USING btree (${theOrgOfAStream}, transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_org_and_correlation',
    indexdef: `CREATE INDEX ledger_messages_by_org_and_correlation ON ONLY public.emt_messages USING btree (${theOrgOfAStream}, ((message_metadata ->> 'correlationId'::text)), transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_org_and_id',
    indexdef: `CREATE INDEX ledger_messages_by_org_and_id ON ONLY public.emt_messages USING btree (${theOrgOfAStream}, message_id)`,
  },
  {
    indexname: 'ledger_messages_by_playbook',
    indexdef: `CREATE INDEX ledger_messages_by_playbook ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_playbook_and_time',
    indexdef: `CREATE INDEX ledger_messages_by_playbook_and_time ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), created, transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_stream',
    indexdef:
      'CREATE INDEX ledger_messages_by_stream ON ONLY public.emt_messages USING btree (stream_id, transaction_id, global_position)',
  },
];
