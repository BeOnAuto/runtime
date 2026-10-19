import { functionVariables } from '../function-settings/function-settings.ts';
import { accessVariables } from '../settings/access-settings.ts';
import { contentVariables } from '../settings/content-settings.ts';
import { ledgerVariables } from '../settings/ledger-settings.ts';
import { secretsVariables } from '../settings/secrets-settings.ts';
import { workflowVariables } from '../settings/workflow-settings.ts';
import { studioVariables } from '../studio/studio-settings.ts';
import { telemetryVariables } from '../telemetry/telemetry-settings.ts';
import { variablesOfTheLibraries } from './variables-of-the-libraries.ts';

export const variablesTheRuntimeReads: readonly string[] = [
  ...accessVariables,
  ...studioVariables,
  ...secretsVariables,
  ...ledgerVariables,
  ...contentVariables,
  ...workflowVariables,
  ...telemetryVariables,
  ...functionVariables,
  ...variablesOfTheLibraries,
];
