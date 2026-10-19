import { SQL } from '@event-driven-io/dumbo';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound, requireTheShapeKept, type KeptTable } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const sealedSecrets = SQL.identifier('sealed_secrets');

export const sealedSecretsShape: KeptTable = {
  name: 'sealed_secrets',
  columns: ['id', 'kid', 'sealed', 'version', 'kept_at', 'claimed_until', 'ends_with'],
  holds: 'secrets',
};

const sealedSecretsTable: PlaybookIndex = {
  name: sealedSecretsShape.name,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${sealedSecrets} (
    id TEXT PRIMARY KEY,
    kid TEXT NOT NULL,
    sealed TEXT NOT NULL,
    version INTEGER NOT NULL,
    kept_at TEXT NOT NULL,
    claimed_until TEXT,
    ends_with TEXT
  )`,
};

export async function createdSecretTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const existing = new Set(await namesFound(execute, dialect.relationsAmong('table', [sealedSecretsShape.name])));
  if (existing.has(sealedSecretsShape.name)) {
    await requireTheShapeKept(execute, dialect, sealedSecretsShape);
  }
  await createMissingIndexes(execute, [sealedSecretsTable], existing);
}
