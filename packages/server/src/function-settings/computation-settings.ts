import type { Environment } from '@on.auto/config';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface ComputationSettings {
  readonly workers: number;
}

const workers = { setting: 'COMPUTATION_WORKERS', least: 1, most: 64, example: 4 };

export const computationVariables: readonly string[] = [workers.setting];

export function readComputationSettings(
  environment: Environment,
): Effect.Effect<ComputationSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'computation settings', bounds: { workers } });
}
