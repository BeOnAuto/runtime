import { consentVariables } from '../consent/consent-settings.ts';
import { functionVariables } from '../function-settings/function-settings.ts';
import { studioAndLicenseVariables } from '../licensing/license-settings.ts';
import { accessVariables } from '../settings/access-settings.ts';
import { contentVariables } from '../settings/content-settings.ts';
import { ledgerAndSecretsVariables } from '../settings/secrets-settings.ts';
import { workflowVariables } from '../settings/workflow-settings.ts';
import { telemetryVariables } from '../telemetry/telemetry-settings.ts';
import { usagePingVariables } from '../usage-ping/usage-ping-settings.ts';
import { variablesOfTheLibraries } from './variables-of-the-libraries.ts';

export const variablesTheRuntimeReads: readonly string[] = [
  ...accessVariables,
  ...studioAndLicenseVariables,
  ...consentVariables,
  ...ledgerAndSecretsVariables,
  ...contentVariables,
  ...workflowVariables,
  ...telemetryVariables,
  ...usagePingVariables,
  ...functionVariables,
  ...variablesOfTheLibraries,
];
