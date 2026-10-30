import type { Environment } from '@on.auto/config';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

export interface PredictionSettings {
  readonly mostFunctions: number;
}

const mostFunctions: CountBounds = { setting: 'PREDICTION_MAX_FUNCTIONS', least: 1, most: 1000, example: 32 };

export const predictionVariables: readonly string[] = [mostFunctions.setting];

export function readPredictionSettings(
  environment: Environment,
): Effect.Effect<PredictionSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'prediction function settings', bounds: { mostFunctions } });
}
