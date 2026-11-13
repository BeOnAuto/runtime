import type { SQL } from '@event-driven-io/dumbo';

import type { Dialect } from '../connection/ledger-connection.ts';
import { sqlOf, type Statement } from '../connection/statement.ts';
import type { StatementExecutor } from '../event-store.ts';
import type { LayoutDialect } from './layout-dialects.ts';
import { factsReadBy, type FactSchemaRead, type FactsRead } from './ledger-facts-refused.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';

export type StatementInEachDialect = Readonly<Record<Dialect, Statement>>;

export type StepSQL = Statement | StatementInEachDialect;

export interface StepInCode {
  readonly inCode: (execute: StatementExecutor, dialect: LayoutDialect) => Promise<void>;
}

export type StepStatement = StepSQL | StepInCode;

export interface LayoutStep {
  readonly layout: number;
  readonly statements: readonly StepStatement[];
}

export interface LayoutCarrying {
  readonly kept: number;
  readonly floor: number;
  readonly steps: readonly LayoutStep[];
  readonly facts?: FactsRead;
}

export interface CarriedTables {
  readonly layoutSteps?: readonly LayoutStep[] | undefined;
  readonly factSchemas?: readonly FactSchemaRead[] | undefined;
  readonly floor?: number | undefined;
}

export function layoutCarryingBy({
  layoutSteps = [],
  factSchemas,
  floor = ledgerLayoutFloor,
}: CarriedTables = {}): LayoutCarrying {
  const carrying = { kept: ledgerLayout, floor, steps: layoutSteps };
  return factSchemas === undefined ? carrying : { ...carrying, facts: factsReadBy(factSchemas) };
}

function isOneStatement(statement: StepSQL): statement is Statement {
  return 'strings' in statement;
}

export function sqlOn(dialect: Dialect, statement: StepSQL): SQL {
  return sqlOf(isOneStatement(statement) ? statement : statement[dialect]);
}

function isInCode(statement: StepStatement): statement is StepInCode {
  return 'inCode' in statement;
}

export async function stepStatementTaken(
  execute: StatementExecutor,
  dialect: LayoutDialect,
  statement: StepStatement,
): Promise<void> {
  if (isInCode(statement)) {
    await statement.inCode(execute, dialect);
    return;
  }
  await execute.command(sqlOn(dialect.dialect, statement));
}

function theStepTo(layout: number, steps: readonly LayoutStep[]): LayoutStep {
  const leading = steps.filter((step) => step.layout === layout);
  if (leading.length === 0) {
    throw new Error(`The ledger was given no step to layout ${layout} of its database, where it takes at least one`);
  }
  return { layout, statements: leading.flatMap(({ statements }) => statements) };
}

export function stepsFrom(layout: number, { kept, steps }: Omit<LayoutCarrying, 'floor'>): readonly LayoutStep[] {
  return Array.from({ length: Math.max(kept - layout, 0) }, (_, index) => theStepTo(layout + index + 1, steps));
}

export function layoutStepsInSequence(steps: readonly LayoutStep[]): readonly LayoutStep[] {
  return stepsFrom(ledgerLayoutFloor, layoutCarryingBy({ layoutSteps: steps }));
}
