import { SQL } from '@event-driven-io/dumbo';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const definitionNamesTableName = 'definition_names_1';

export const definitionNames = SQL.identifier(definitionNamesTableName);

const byDefinitionIndexName = `${definitionNamesTableName}_by_definition`;

const definitionNamesTable: PlaybookIndex = {
  name: definitionNamesTableName,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${definitionNames} (
    playbook_key TEXT NOT NULL,
    definition_type TEXT NOT NULL,
    name TEXT NOT NULL,
    definition_key TEXT NOT NULL,
    status TEXT NOT NULL,
    has_triggers BOOLEAN NOT NULL,
    PRIMARY KEY (playbook_key, definition_type, name)
  )`,
};

const byDefinitionIndex: PlaybookIndex = {
  name: byDefinitionIndexName,
  create: () =>
    SQL`CREATE UNIQUE INDEX IF NOT EXISTS ${SQL.identifier(byDefinitionIndexName)} ON ${definitionNames} (definition_key)`,
};

export async function createdDefinitionNamesTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const tables = new Set(await namesFound(execute, dialect.relationsAmong('table', [definitionNamesTableName])));
  await createMissingIndexes(execute, [definitionNamesTable], tables);
  const indexes = new Set(await namesFound(execute, dialect.relationsAmong('index', [byDefinitionIndexName])));
  await createMissingIndexes(execute, [byDefinitionIndex], indexes);
}
