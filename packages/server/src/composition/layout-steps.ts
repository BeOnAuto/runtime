import { definitionTypeOrder } from '@on.auto/definitions';
import { definitionNamesOf } from '@on.auto/definitions/identity';
import { generationLayoutSteps } from '@on.auto/generation';
import { definitionNamesFilledBy, ledgerLayoutSteps, type LayoutStep } from '@on.auto/ledger';
import { predictionLayoutSteps } from '@on.auto/prediction';
import { hostLayoutSteps } from '@on.auto/workflow-host';

const mostBytesFilledAtOnce = 16 * 1_048_576;

export const layoutSteps: readonly LayoutStep[] = [
  ...ledgerLayoutSteps,
  { layout: 23, statements: [definitionNamesFilledBy(definitionNamesOf(definitionTypeOrder), mostBytesFilledAtOnce)] },
  ...hostLayoutSteps,
  ...predictionLayoutSteps,
  ...generationLayoutSteps,
].toSorted((one, other) => one.layout - other.layout);
