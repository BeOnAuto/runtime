import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { createMissingIndexes, type PlaybookIndex, type IndexExecutor } from '../recorded/missing-indexes.ts';

export const playbookKeyOfStream = "substring(stream_id FROM '^(?:[^/]*/){3}')";

export const kindKeyOfStream = "substring(stream_id FROM '^(?:[^/]*/){4}')";

export const correlationOfMessage = "(message_metadata ->> 'correlationId')";

export const definitionTypeOfStream = "substring(stream_id FROM '^(?:[^/]*/){3}definitions/([^/]+)$')";

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const playbookKey = SQL.plain(playbookKeyOfStream);

const playbookIndexes: readonly PlaybookIndex[] = [
  {
    name: 'ledger_messages_by_playbook',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook
      ON emt_messages ((${playbookKey}), transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_playbook_and_time',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_time
      ON emt_messages ((${playbookKey}), created, transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_stream',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_stream
      ON emt_messages (stream_id, transaction_id, global_position)`,
  },
  {
    name: 'ledger_first_messages_by_kind',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind
      ON emt_messages ((${SQL.plain(kindKeyOfStream)}), stream_position, transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_playbook_and_correlation',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_correlation
      ON emt_messages ((${playbookKey}), ${SQL.plain(correlationOfMessage)}, transaction_id, global_position)`,
  },
  {
    name: 'ledger_definition_streams',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_definition_streams
      ON emt_streams ((${SQL.plain(definitionTypeOfStream)})) WHERE (${SQL.plain(definitionTypeOfStream)}) IS NOT NULL`,
  },
  {
    name: 'ledger_messages_by_id',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_id ON emt_messages (message_id)`,
  },
];

export async function createPostgreSQLPlaybookIndexes({ execute }: { readonly execute: IndexExecutor }): Promise<void> {
  const names = SQL.merge(
    playbookIndexes.map(({ name }) => SQL`${name}`),
    ', ',
  );
  const { rows } = await execute.query(
    SQL`SELECT relname AS name FROM pg_class
      WHERE relkind IN ('i', 'I') AND relname IN (${names}) AND pg_table_is_visible(oid)`,
  );
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  const created = await createMissingIndexes(execute, playbookIndexes, existing);
  if (created > 0) {
    await execute.command(SQL`ANALYZE emt_messages, emt_streams`);
  }
}
