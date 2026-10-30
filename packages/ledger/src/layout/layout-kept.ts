import { SQL } from '@event-driven-io/dumbo';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { NamedProjection } from '../projections/projection-fill.ts';
import type { LayoutDialect } from './layout-dialects.ts';
import { layoutFound, layoutKeptIn, layoutTable, type FoundLayout } from './layout-found.ts';
import { sqlOn, stepsFrom, type LayoutCarrying, type LayoutStep } from './layout-steps.ts';
import { requireTheFactsRead } from './ledger-facts-refused.ts';
import { ledgerLayoutRefused } from './ledger-layout-refused.ts';

export function layoutWritten(execute: StatementExecutor, layout: number): Promise<void> {
  return inTurn(
    [
      SQL`CREATE TABLE ${SQL.identifier(layoutTable)} (
        one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row),
        layout INTEGER NOT NULL
      )`,
      SQL`INSERT INTO ${SQL.identifier(layoutTable)} (layout) VALUES (${layout})`,
    ],
    (statement) => execute.command(statement),
  );
}

function isNew({ layout, tables }: FoundLayout): boolean {
  return layout === undefined && tables.length === 0;
}

function isCarriedForward(layout: number | undefined, { kept, floor }: LayoutCarrying): layout is number {
  return layout !== undefined && layout >= floor && layout < kept;
}

async function layoutToCarryForward(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  projected: readonly NamedProjection[],
  carrying: LayoutCarrying,
): Promise<number | undefined> {
  const found = await layoutFound(execute, dialect, projected);
  if (isNew(found)) {
    await layoutWritten(execute, carrying.kept);
    return undefined;
  }
  if (found.layout !== carrying.kept && !isCarriedForward(found.layout, carrying)) {
    throw ledgerLayoutRefused({ found: found.layout, kept: carrying.kept, floor: carrying.floor });
  }
  await requireTheFactsRead(execute, dialect, found.tables, carrying.facts);
  return found.layout === carrying.kept ? undefined : found.layout;
}

async function stepTakenIn(execute: StatementExecutor, dialect: LayoutDialect, step: LayoutStep): Promise<void> {
  if ((await layoutKeptIn(execute)) >= step.layout) {
    return;
  }
  await inTurn(step.statements, (statement) => execute.command(sqlOn(dialect.dialect, statement)));
  await execute.command(SQL`UPDATE ${SQL.identifier(layoutTable)} SET layout = ${step.layout}`);
}

export async function requireTheLayoutKept(
  inTransaction: InTransaction,
  dialect: LayoutDialect,
  projected: readonly NamedProjection[],
  carrying: LayoutCarrying,
): Promise<void> {
  const carried = await inTransaction((execute) => layoutToCarryForward(execute, dialect, projected, carrying));
  if (carried !== undefined) {
    await inTurn(stepsFrom(carried, carrying), (step) =>
      inTransaction((execute) => stepTakenIn(execute, dialect, step)),
    );
  }
}
