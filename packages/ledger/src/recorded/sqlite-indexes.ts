import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { createMissingIndexes, type PlaybookIndex, type IndexExecutor } from './missing-indexes.ts';

function prefixThroughSlashes(count: number): string {
  const end = Array.from({ length: count - 1 }).reduce<string>(
    (found) => `${found} + instr(substr(stream_id, ${found} + 1), '/')`,
    "instr(stream_id, '/')",
  );
  return `substr(stream_id, 1, ${end})`;
}

const playbookKeyText = prefixThroughSlashes(3);

export const playbookKeyOfStream = SQL.plain(playbookKeyText);

export const kindKeyOfStream = SQL.plain(prefixThroughSlashes(4));

const definitionsKind = 'definitions/';

export const definitionTypeOfStream = SQL.plain(
  `CASE WHEN substr(stream_id, length(${playbookKeyText}) + 1, ${definitionsKind.length}) = '${definitionsKind}' THEN substr(stream_id, length(${playbookKeyText}) + ${definitionsKind.length + 1}) END`,
);

export const correlationOfMessage = SQL.plain("json_extract(message_metadata, '$.correlationId')");

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const playbookIndexes: readonly PlaybookIndex[] = [
  {
    name: 'ledger_messages_by_playbook',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook ON emt_messages (${playbookKeyOfStream}, global_position)`,
  },
  {
    name: 'ledger_messages_by_playbook_and_time',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_time ON emt_messages (${playbookKeyOfStream}, created)`,
  },
  {
    name: 'ledger_messages_by_stream',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)`,
  },
  {
    name: 'ledger_first_messages_by_kind',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind
      ON emt_messages (${kindKeyOfStream}, global_position) WHERE stream_position = 1`,
  },
  {
    name: 'ledger_messages_by_playbook_and_correlation',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_correlation
      ON emt_messages (${playbookKeyOfStream}, ${correlationOfMessage}, global_position)`,
  },
  {
    name: 'ledger_definition_streams',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_definition_streams
      ON emt_streams (${definitionTypeOfStream}) WHERE ${definitionTypeOfStream} IS NOT NULL`,
  },
  {
    name: 'ledger_messages_by_id',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_id ON emt_messages (message_id)`,
  },
];

export async function createSQLitePlaybookIndexes(execute: IndexExecutor): Promise<void> {
  const names = JSON.stringify(playbookIndexes.map(({ name }) => name));
  const { rows } = await execute.query(
    SQL`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(${names}))`,
  );
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  await createMissingIndexes(execute, playbookIndexes, existing);
}
