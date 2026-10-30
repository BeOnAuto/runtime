import { configFileVariable, serverConfigVariables } from '@on.auto/config';
import { connectionsSetting } from '@on.auto/connections';
import { apiKeysVariable } from '@on.auto/identity';
import { awsCredentialVariables, proxySettingsVariables } from '@on.auto/outbound';

export const variablesOfTheLibraries: readonly string[] = [
  ...serverConfigVariables,
  configFileVariable,
  apiKeysVariable,
  ...proxySettingsVariables,
  ...awsCredentialVariables,
  connectionsSetting,
];
