import { postgresqlContent } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createPostgreSQLPlaybookIndexes } from '../postgresql-reads/playbook-indexes.ts';
import { createdSecretTable } from '../secrets/kept-secrets.ts';

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLPlaybookIndexes({ execute });
  await createdContentTables(execute, postgresqlContent);
  await createdSecretTable(execute, postgresqlContent);
}
