import type { Environment, FileUse } from '@on.auto/config';
import { makeProviderResolver } from '@on.auto/connections';
import { readProviders } from '@on.auto/providers';
import { Effect, Result } from 'effect';

import {
  readConnections,
  readConnectionSettings,
  type ConnectionSettings,
} from '../connections/connection-settings.ts';
import { readFunctionSettings, type FunctionSettings } from '../function-settings/function-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

export interface ServedSettings extends FunctionSettings, ConnectionSettings {
  readonly workflows: WorkflowSettings;
}

export function readServedSettings(environment: Environment, file: FileUse | undefined): ServedSettings {
  const connections = readConnections(environment, file, Result.getOrThrow(readProviders()));
  const functions = readFunctionSettings(environment, file, makeProviderResolver(connections.providers));
  return {
    ...functions,
    ...readConnectionSettings(environment, file, functions, connections),
    workflows: Effect.runSync(readWorkflowSettings(environment)),
  };
}
