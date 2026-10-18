import type { Environment, FileUse } from '@on.auto/config';
import { Effect } from 'effect';

import { readConnectionSettings, type ConnectionSettings } from '../connections/connection-settings.ts';
import { readFunctionSettings, type FunctionSettings } from '../function-settings/function-settings.ts';
import { readWorkflowSettings, type WorkflowSettings } from './workflow-settings.ts';

export interface ServedSettings extends FunctionSettings, ConnectionSettings {
  readonly workflows: WorkflowSettings;
}

export function readServedSettings(environment: Environment, file: FileUse | undefined): ServedSettings {
  const functions = readFunctionSettings(environment, file);
  return {
    ...functions,
    ...readConnectionSettings(environment, file, functions),
    workflows: Effect.runSync(readWorkflowSettings(environment)),
  };
}
