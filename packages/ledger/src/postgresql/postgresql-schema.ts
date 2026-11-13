import { postgresqlContent } from '../content/content-dialects.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createdOwnTables } from '../layout/own-tables.ts';
import { createPostgreSQLPlaybookIndexes } from '../postgresql-reads/playbook-indexes.ts';

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLPlaybookIndexes({ execute });
  await createdOwnTables(execute, postgresqlContent);
}
