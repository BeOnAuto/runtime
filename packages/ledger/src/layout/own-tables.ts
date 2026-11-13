import type { ContentDialect } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import { createdDefinitionNamesTable } from '../definition-names/definition-names-table.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createdSecretTable } from '../secrets/kept-secrets.ts';
import { createdReceivedWebhooksTable } from '../webhooks/received-webhooks-table.ts';

export async function createdOwnTables(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  await createdContentTables(execute, dialect);
  await createdSecretTable(execute, dialect);
  await createdReceivedWebhooksTable(execute, dialect);
  await createdDefinitionNamesTable(execute, dialect);
}
