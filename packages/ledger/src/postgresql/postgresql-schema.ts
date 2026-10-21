import { postgresqlContent } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import { requireTheLayoutKept } from '../layout/layout-kept.ts';
import { createPostgreSQLPlaybookIndexes } from '../postgresql-reads/playbook-indexes.ts';
import { createdSecretTable } from '../secrets/kept-secrets.ts';
import { migrationLockTakenWithin } from './postgresql-run-outcomes.ts';

interface Migration {
  readonly execute: StatementExecutor;
}

export async function beforeTheSchema(migration: Migration): Promise<void> {
  await migrationLockTakenWithin()(migration);
  await requireTheLayoutKept(migration.execute, postgresqlLayout);
}

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLPlaybookIndexes({ execute });
  await createdContentTables(execute, postgresqlContent);
  await createdSecretTable(execute, postgresqlContent);
}
