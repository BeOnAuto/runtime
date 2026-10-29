import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { contentTableNames, namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { versionOfTable, type NamedProjection } from '../projections/projection-fill.ts';
import { keptSecretsTableName } from '../secrets/kept-secrets.ts';
import type { LayoutDialect } from './layout-dialects.ts';

export interface FoundLayout {
  readonly layout: number | undefined;
  readonly tables: readonly string[];
}

export const layoutTable = 'ledger_layout';

const tablesOfTheLayout: ReadonlySet<string> = new Set([layoutTable, ...contentTableNames, keptSecretsTableName]);

const prefixesOfTheStore: readonly string[] = ['emt_', 'dmb_'];

function isTheLedgers(table: string, projected: readonly NamedProjection[]): boolean {
  return (
    tablesOfTheLayout.has(table) ||
    projected.some((projection) => versionOfTable(projection, table) !== undefined) ||
    prefixesOfTheStore.some((prefix) => table.startsWith(prefix))
  );
}

const LayoutRow = Schema.Tuple([Schema.Struct({ layout: Schema.Number })]);

export async function layoutKeptIn(execute: StatementExecutor): Promise<number> {
  const { rows } = await execute.query(SQL`SELECT layout FROM ${SQL.identifier(layoutTable)}`);
  const [{ layout }] = Schema.decodeUnknownSync(LayoutRow)(rows);
  return layout;
}

export async function layoutFound(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  projected: readonly NamedProjection[],
): Promise<FoundLayout> {
  const tables = (await namesFound(execute, dialect.tablesOfTheSchema())).filter((table) =>
    isTheLedgers(table, projected),
  );
  return { layout: tables.includes(layoutTable) ? await layoutKeptIn(execute) : undefined, tables };
}
