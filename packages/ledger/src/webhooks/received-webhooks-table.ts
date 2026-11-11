import { SQL } from '@event-driven-io/dumbo';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const receivedWebhooksTableName = 'webhooks_received';

export const receivedWebhooks = SQL.identifier(receivedWebhooksTableName);

const keptUntilIndexName = `${receivedWebhooksTableName}_kept_until`;

const receivedWebhooksTable: PlaybookIndex = {
  name: receivedWebhooksTableName,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${receivedWebhooks} (
    org TEXT NOT NULL,
    connection TEXT NOT NULL,
    webhook_id TEXT NOT NULL,
    taken_for TEXT NOT NULL,
    kept_until BIGINT NOT NULL,
    PRIMARY KEY (org, connection, webhook_id)
  )`,
};

const keptUntilIndex: PlaybookIndex = {
  name: keptUntilIndexName,
  create: () =>
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.identifier(keptUntilIndexName)} ON ${receivedWebhooks} (kept_until)`,
};

export async function createdReceivedWebhooksTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const tables = new Set(await namesFound(execute, dialect.relationsAmong('table', [receivedWebhooksTableName])));
  await createMissingIndexes(execute, [receivedWebhooksTable], tables);
  const indexes = new Set(await namesFound(execute, dialect.relationsAmong('index', [keptUntilIndexName])));
  await createMissingIndexes(execute, [keptUntilIndex], indexes);
}
