import type { Environment } from '@on.auto/config';
import { Effect } from 'effect';

import { computationVariables, readComputationSettings, type ComputationSettings } from './computation-settings.ts';
import { documentVariables, readDocumentSettings, type DocumentSettings } from './document-settings.ts';
import { generationVariables, readGenerationSettings, type GenerationSettings } from './generation-settings.ts';
import { interactionVariables, readInteractionSettings, type InteractionSettings } from './interaction-settings.ts';
import { predictionVariables, readPredictionSettings, type PredictionSettings } from './prediction-settings.ts';
import { projectionVariables, readProjectionSettings, type ProjectionSettings } from './projection-settings.ts';

export interface FunctionBounds {
  readonly computation: ComputationSettings;
  readonly interaction: InteractionSettings;
  readonly prediction: PredictionSettings;
  readonly projection: ProjectionSettings;
  readonly generation: GenerationSettings;
  readonly documents: DocumentSettings;
}

export const functionBoundsVariables: readonly string[] = [
  ...computationVariables,
  ...interactionVariables,
  ...predictionVariables,
  ...projectionVariables,
  ...generationVariables,
  ...documentVariables,
];

export function readFunctionBounds(environment: Environment): FunctionBounds {
  return {
    computation: Effect.runSync(readComputationSettings(environment)),
    interaction: Effect.runSync(readInteractionSettings(environment)),
    prediction: Effect.runSync(readPredictionSettings(environment)),
    projection: Effect.runSync(readProjectionSettings(environment)),
    generation: Effect.runSync(readGenerationSettings(environment)),
    documents: Effect.runSync(readDocumentSettings(environment)),
  };
}
