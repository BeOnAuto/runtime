import { SQL } from '@event-driven-io/dumbo';
import { projectedTableOf, type ProjectionDeclaration } from '@on.auto/operations';
import { Context, Effect, Schema } from 'effect';

import type { ContentDialect } from '../content/content-dialects.ts';
import { namesFound } from '../content/content-tables.ts';
import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { namesIn, tableAnalysis, tableDrop } from '../projections/projection-statements.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const projectionCheckpointsTableName = 'projection_checkpoints';

const checkpoints = SQL.identifier(projectionCheckpointsTableName);

const projectionCheckpointsTable: PlaybookIndex = {
  name: projectionCheckpointsTableName,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${checkpoints} (
    projection TEXT NOT NULL,
    version INTEGER NOT NULL,
    folded_through TEXT,
    PRIMARY KEY (projection, version)
  )`,
};

export async function createdProjectionCheckpointsTable(
  execute: StatementExecutor,
  dialect: ContentDialect,
): Promise<void> {
  const tables = new Set(await namesFound(execute, dialect.relationsAmong('table', [projectionCheckpointsTableName])));
  await createMissingIndexes(execute, [projectionCheckpointsTable], tables);
}

export type VersionedProjection = Pick<ProjectionDeclaration, 'name' | 'version'>;

function caughtUpWritten({ name, version }: VersionedProjection): SQL {
  return SQL`INSERT INTO ${checkpoints} (projection, version, folded_through) VALUES (${name}, ${version}, NULL)
    ON CONFLICT (projection, version) DO UPDATE SET folded_through = NULL`;
}

export function earlierVersionsForgotten({ name, version }: VersionedProjection): SQL {
  return SQL`DELETE FROM ${checkpoints} WHERE projection = ${name} AND version < ${version}`;
}

const FoldedRows = Schema.Array(Schema.Struct({ folded_through: Schema.NullOr(Schema.String) }));

export async function isCaughtUp(
  execute: Pick<StatementExecutor, 'query'>,
  { name, version }: VersionedProjection,
): Promise<boolean> {
  const { rows } = await execute.query(
    SQL`SELECT folded_through FROM ${checkpoints} WHERE projection = ${name} AND version = ${version}`,
  );
  return Schema.decodeUnknownSync(FoldedRows)(rows).some(({ folded_through }) => folded_through === null);
}

export type TableMadeAgain = (table: string) => void;

export function tablesMadeAgainLoggedWith(context: Context.Context<never>): TableMadeAgain {
  return (table) => {
    Effect.runForkWith(context)(
      Effect.logWarning(
        'A projection’s table was not recorded as caught up, so the ledger dropped it and made it again from the facts',
      ).pipe(Effect.annotateLogs({ table })),
    );
  };
}

export const tablesMadeAgainLogged: TableMadeAgain = tablesMadeAgainLoggedWith(Context.empty());

export interface Preparation {
  readonly execute: StatementExecutor;
  readonly inTransaction: InTransaction;
  readonly madeAgain: TableMadeAgain | undefined;
}

interface TableToKeep {
  readonly dialect: ProjectionDialect;
  readonly projection: VersionedProjection;
  readonly isEarlier: (table: string) => boolean;
  readonly made: (execute: StatementExecutor) => Promise<void>;
}

export async function tableKept(
  { dialect, projection, isEarlier, made }: TableToKeep,
  { execute, inTransaction, madeAgain = tablesMadeAgainLogged }: Preparation,
): Promise<void> {
  const found = await namesIn(execute, dialect.tableVersions(projection.name));
  const current = projectedTableOf(projection);
  const present = found.includes(current);
  if (present && (await isCaughtUp(execute, projection))) {
    return;
  }
  await inTransaction(async (transaction) => {
    if (present) {
      await transaction.command(tableDrop(current));
    }
    await made(transaction);
    await transaction.command(caughtUpWritten(projection));
    await inTurn(
      found.filter((table) => isEarlier(table)),
      (table) => transaction.command(tableDrop(table)),
    );
    await transaction.command(earlierVersionsForgotten(projection));
    await transaction.command(tableAnalysis(projection));
  });
  if (present) {
    madeAgain(current);
  }
}
