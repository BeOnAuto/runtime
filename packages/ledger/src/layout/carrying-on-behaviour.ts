import type { LayoutStep } from './layout-steps.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';
import { ledgerLayoutSteps } from './ledger-steps.ts';

export const theLayoutOfTheLastLedgerStep = Math.max(...ledgerLayoutSteps.map(({ layout }) => layout));

const stepsOfOtherPackagesAfterTheLedgers = Array.from(
  { length: ledgerLayout - theLayoutOfTheLastLedgerStep },
  (_, at): LayoutStep => ({ layout: theLayoutOfTheLastLedgerStep + at + 1, statements: [] }),
);

export const carryingOnToTheLayoutKept = {
  kept: ledgerLayout,
  floor: ledgerLayoutFloor,
  steps: [...ledgerLayoutSteps, ...stepsOfOtherPackagesAfterTheLedgers],
};
