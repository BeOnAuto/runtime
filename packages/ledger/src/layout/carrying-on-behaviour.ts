import type { LayoutCarrying, LayoutStep } from './layout-steps.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';
import { ledgerLayoutSteps } from './ledger-steps.ts';

export const theLayoutOfTheLastLedgerStep = Math.max(...ledgerLayoutSteps.map(({ layout }) => layout));

const layoutsOfTheLedgersSteps = new Set(ledgerLayoutSteps.map(({ layout }) => layout));

const stepsOfOtherPackages = Array.from(
  { length: ledgerLayout - ledgerLayoutFloor },
  (_, at) => ledgerLayoutFloor + at + 1,
)
  .filter((layout) => !layoutsOfTheLedgersSteps.has(layout))
  .map((layout): LayoutStep => ({ layout, statements: [] }));

const ledgerStepsAmongOthers: readonly LayoutStep[] = [...ledgerLayoutSteps, ...stepsOfOtherPackages];

export function carryingTo(kept: number): LayoutCarrying {
  return { kept, floor: ledgerLayoutFloor, steps: ledgerStepsAmongOthers };
}

export const carryingOnToTheLayoutKept = carryingTo(ledgerLayout);
