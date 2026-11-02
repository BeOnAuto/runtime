import type { Environment, FileUse } from '@on.auto/config';
import type { ProviderResolver } from '@on.auto/tool-servers';

import { extensionVariables, readExtensionSettings, type ExtensionEntry } from '../extensions/extension-settings.ts';
import { functionBoundsVariables, readFunctionBounds, type FunctionBounds } from './function-bounds.ts';
import { readReasoningSettings, reasoningVariables, type ReasoningSettings } from './reasoning-settings.ts';

export interface FunctionSettings extends ReasoningSettings, FunctionBounds {
  readonly extensions: readonly ExtensionEntry[];
}

export const functionVariables: readonly string[] = [
  ...reasoningVariables,
  ...functionBoundsVariables,
  ...extensionVariables,
];

export function readFunctionSettings(
  environment: Environment,
  file: FileUse | undefined,
  providers: ProviderResolver,
): FunctionSettings {
  const { models, modelProviders, toolServers, reasoning } = readReasoningSettings(environment, file, providers);
  return {
    models,
    modelProviders,
    toolServers,
    reasoning,
    ...readFunctionBounds(environment),
    extensions: readExtensionSettings(environment),
  };
}
