import type { SQL } from '@event-driven-io/dumbo';

import type { Dialect } from '../connection/ledger-connection.ts';
import { sqlOf, type Statement } from '../connection/statement.ts';
import { factsReadBy, type FactSchemaRead, type FactsRead } from './ledger-facts-refused.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';

export type StatementInEachDialect = Readonly<Record<Dialect, Statement>>;

export type StepStatement = Statement | StatementInEachDialect;

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
}

export function layoutCarryingBy({ layoutSteps = [], factSchemas }: CarriedTables = {}): LayoutCarrying {
  const carrying = { kept: ledgerLayout, floor: ledgerLayoutFloor, steps: layoutSteps };
  return factSchemas === undefined ? carrying : { ...carrying, facts: factsReadBy(factSchemas) };
}

function isOneStatement(statement: StepStatement): statement is Statement {
  return 'strings' in statement;
}

export function sqlOn(dialect: Dialect, statement: StepStatement): SQL {
  return sqlOf(isOneStatement(statement) ? statement : statement[dialect]);
}

function theStepTo(layout: number, steps: readonly LayoutStep[]): LayoutStep {
  const leading = steps.filter((step) => step.layout === layout);
  const [step] = leading;
  if (step === undefined || leading.length > 1) {
    throw new Error(
      `The ledger was given ${leading.length} steps to layout ${layout} of its database, where it takes exactly one`,
    );
  }
  return step;
}

export function stepsFrom(layout: number, { kept, steps }: Omit<LayoutCarrying, 'floor'>): readonly LayoutStep[] {
  return Array.from({ length: Math.max(kept - layout, 0) }, (_, index) => theStepTo(layout + index + 1, steps));
}

export function layoutStepsInSequence(steps: readonly LayoutStep[]): readonly LayoutStep[] {
  return stepsFrom(ledgerLayoutFloor, layoutCarryingBy({ layoutSteps: steps }));
}
