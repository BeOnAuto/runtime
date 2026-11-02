import { generationLayoutSteps } from '@on.auto/generation';
import { ledgerLayoutSteps, type LayoutStep } from '@on.auto/ledger';
import { memoryLayoutSteps } from '@on.auto/memory';
import { predictionLayoutSteps } from '@on.auto/prediction';
import { hostLayoutSteps } from '@on.auto/workflow-host';

export const layoutSteps: readonly LayoutStep[] = [
  ...ledgerLayoutSteps,
  ...hostLayoutSteps,
  ...predictionLayoutSteps,
  ...memoryLayoutSteps,
  ...generationLayoutSteps,
].toSorted((one, other) => one.layout - other.layout);
