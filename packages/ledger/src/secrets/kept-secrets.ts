import { SQL } from '@event-driven-io/dumbo';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const keptSecrets = SQL.identifier('kept_secrets');

const keptSecretsTable: PlaybookIndex = {
  name: 'kept_secrets',
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${keptSecrets} (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    kept_at TEXT NOT NULL,
    claimed_until TEXT,
    ends_with TEXT,
    kept_by TEXT NOT NULL,
    held TEXT NOT NULL,
    wrapped_key TEXT,
    kid TEXT
  )`,
};

export async function createdSecretTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const existing = new Set(await namesFound(execute, dialect.relationsAmong('table', [keptSecretsTable.name])));
  await createMissingIndexes(execute, [keptSecretsTable], existing);
}
