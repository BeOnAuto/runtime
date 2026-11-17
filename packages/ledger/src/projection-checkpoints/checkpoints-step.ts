import { namesFound } from '../content/content-tables.ts';
import { prefixesOfTheStore } from '../layout/layout-found.ts';
import type { StepInCode } from '../layout/layout-steps.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { versionOfTable } from '../projections/projection-fill.ts';
import { caughtUpFound, projectionCheckpointsTable, type VersionedProjection } from './projection-checkpoints.ts';

export const projectionCheckpointsLayout = 26;

const mostVersionKept = 2 ** 31 - 1;

const prefixesOfOthers: readonly string[] = [...prefixesOfTheStore, 'sqlite_'];

function projectionOfTable(table: string): VersionedProjection | undefined {
  const name = table.slice(0, Math.max(table.lastIndexOf('_'), 0));
  const version = versionOfTable({ name }, table);
  return name === '' || version === undefined || version > mostVersionKept ? undefined : { name, version };
}

function projectionsOfTheTables(tables: readonly string[]): readonly VersionedProjection[] {
  return tables
    .filter((table) => !prefixesOfOthers.some((prefix) => table.startsWith(prefix)))
    .flatMap((table) => {
      const projection = projectionOfTable(table);
      return projection === undefined ? [] : [projection];
    });
}

export const everyTableFoundCaughtUp: StepInCode = {
  inCode: async (execute, dialect) => {
    await execute.command(projectionCheckpointsTable.create());
    const tables = await namesFound(execute, dialect.tablesOfTheSchema());
    await inTurn(projectionsOfTheTables(tables), (projection) => execute.command(caughtUpFound(projection)));
  },
};
