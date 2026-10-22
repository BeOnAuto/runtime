import type { Environment, FileUse } from '@on.auto/config';
import { makeProviderResolver } from '@on.auto/connections';
import type { ShippedFiles } from '@on.auto/operations';
import { readProviders, type ProviderList } from '@on.auto/providers';
import { Effect, Result } from 'effect';

import {
  readConnections,
  readConnectionSettings,
  type ConnectionSettings,
} from '../connections/connection-settings.ts';
import {
  readAutoClientsSettings,
  type AutoClientsDeciding,
  type AutoClientsSettings,
} from '../consent/consent-settings.ts';
import { readFunctionSettings, type FunctionSettings } from '../function-settings/function-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

export interface ServedSettings extends FunctionSettings, ConnectionSettings {
  readonly workflows: WorkflowSettings;
  readonly autoClients: AutoClientsSettings;
}

export interface ShippedSettings {
  readonly providers: ProviderList;
}

export async function readShippedSettings(shippedFiles: ShippedFiles): Promise<ShippedSettings> {
  return { providers: Result.getOrThrow(await readProviders(shippedFiles)) };
}

export function readServedSettings(
  environment: Environment,
  file: FileUse | undefined,
  access: Omit<AutoClientsDeciding, 'written'>,
  shipped: ShippedSettings,
): ServedSettings {
  const connections = readConnections(environment, file, shipped.providers);
  const functions = readFunctionSettings(environment, file, makeProviderResolver(connections.providers));
  const connectionSettings = readConnectionSettings(environment, file, functions, connections);
  return {
    ...functions,
    ...connectionSettings,
    workflows: Effect.runSync(readWorkflowSettings(environment)),
    autoClients: readAutoClientsSettings(environment, { ...access, written: connectionSettings.autoClientsWritten }),
  };
}
