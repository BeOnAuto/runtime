import { definitionStreamsStatement } from './postgresql-definition-streams.ts';

export const definitionStreamsPlan = {
  explained: `EXPLAIN ${definitionStreamsStatement}`,
  values: ['recall', 'emt:default'],
  throughTheIndex: `Index Cond: ("substring"(stream_id, '^(?:[^/]*/){3}definitions/([^/]+)$'::text) = `,
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
    indexname: 'ledger_messages_by_id',
    indexdef: 'CREATE INDEX ledger_messages_by_id ON ONLY public.emt_messages USING btree (message_id)',
  },
  {
    indexname: 'ledger_messages_by_playbook',
    indexdef: `CREATE INDEX ledger_messages_by_playbook ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), transaction_id, global_position)`,
  },
  {
    indexname: 'ledger_messages_by_playbook_and_correlation',
    indexdef: `CREATE INDEX ledger_messages_by_playbook_and_correlation ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), ((message_metadata ->> 'correlationId'::text)), transaction_id, global_position)`,
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
