import { SQL } from '@event-driven-io/dumbo';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const runIdsTableName = 'run_ids_1';

export const runIds = SQL.identifier(runIdsTableName);

const runIdsTable: PlaybookIndex = {
  name: runIdsTableName,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${runIds} (
    org_key TEXT NOT NULL,
    run_id TEXT NOT NULL,
    definition_key TEXT NOT NULL,
    PRIMARY KEY (org_key, run_id)
  )`,
};

export async function createdRunIdsTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const tables = new Set(await namesFound(execute, dialect.relationsAmong('table', [runIdsTableName])));
  await createMissingIndexes(execute, [runIdsTable], tables);
}
