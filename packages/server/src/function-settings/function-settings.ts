import type { Environment, FileUse } from '@on.auto/config';
import type { ProviderResolver } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { extensionVariables, readExtensionSettings, type ExtensionEntry } from '../extensions/extension-settings.ts';
import { computationVariables, readComputationSettings, type ComputationSettings } from './computation-settings.ts';
import { interactionVariables, readInteractionSettings, type InteractionSettings } from './interaction-settings.ts';
import { predictionVariables, readPredictionSettings, type PredictionSettings } from './prediction-settings.ts';
import { readReasoningSettings, reasoningVariables, type ReasoningSettings } from './reasoning-settings.ts';
import { readRecallSettings, recallVariables, type RecallSettings } from './recall-settings.ts';

export interface FunctionSettings extends ReasoningSettings {
  readonly computation: ComputationSettings;
  readonly recall: RecallSettings;
  readonly interaction: InteractionSettings;
  readonly prediction: PredictionSettings;
  readonly extensions: readonly ExtensionEntry[];
}

export const functionVariables: readonly string[] = [
  ...reasoningVariables,
  ...computationVariables,
  ...recallVariables,
  ...interactionVariables,
  ...predictionVariables,
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
    computation: Effect.runSync(readComputationSettings(environment)),
    recall: Effect.runSync(readRecallSettings(environment)),
    interaction: Effect.runSync(readInteractionSettings(environment)),
    prediction: Effect.runSync(readPredictionSettings(environment)),
    extensions: readExtensionSettings(environment),
  };
}
