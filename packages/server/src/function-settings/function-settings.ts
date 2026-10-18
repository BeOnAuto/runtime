import type { Environment, FileUse } from '@on.auto/config';
import { Effect } from 'effect';

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
}

export const functionVariables: readonly string[] = [
  ...reasoningVariables,
  ...computationVariables,
  ...recallVariables,
  ...interactionVariables,
  ...predictionVariables,
];

export function readFunctionSettings(environment: Environment, file: FileUse | undefined): FunctionSettings {
  const { models, modelProviders, toolServers, reasoning } = readReasoningSettings(environment, file);
  return {
    models,
    modelProviders,
    toolServers,
    reasoning,
    computation: Effect.runSync(readComputationSettings(environment)),
    recall: Effect.runSync(readRecallSettings(environment)),
    interaction: Effect.runSync(readInteractionSettings(environment)),
    prediction: Effect.runSync(readPredictionSettings(environment)),
  };
}
