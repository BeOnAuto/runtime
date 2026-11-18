import type { ContentDialect } from '../content/content-dialects.ts';
import { contentTableNames, createdContentTables } from '../content/content-tables.ts';
import { createdDefinitionNamesTable, definitionNamesTableName } from '../definition-names/definition-names-table.ts';
import type { StatementExecutor } from '../event-store.ts';
import {
  createdProjectionCheckpointsTable,
  projectionCheckpointsTableName,
} from '../projection-checkpoints/projection-checkpoints.ts';
import { createdRunIdsTable, runIdsTableName } from '../run-ids/run-ids-table.ts';
import { createdSecretTable, keptSecretsTableName } from '../secrets/kept-secrets.ts';
import { createdReceivedWebhooksTable, receivedWebhooksTableName } from '../webhooks/received-webhooks-table.ts';

export const ownTableNames: readonly string[] = [
  ...contentTableNames,
  keptSecretsTableName,
  receivedWebhooksTableName,
  definitionNamesTableName,
  runIdsTableName,
  projectionCheckpointsTableName,
];

export async function createdOwnTables(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  await createdContentTables(execute, dialect);
  await createdSecretTable(execute, dialect);
  await createdReceivedWebhooksTable(execute, dialect);
  await createdDefinitionNamesTable(execute, dialect);
  await createdRunIdsTable(execute, dialect);
  await createdProjectionCheckpointsTable(execute, dialect);
}
