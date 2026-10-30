import type { Environment } from '@on.auto/config';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface RecallSettings {
  readonly mostFunctions: number;
  readonly rebuildsAtOnce: number;
  readonly playbooksAtOnce: number;
}

const bounds = {
  mostFunctions: { setting: 'RECALL_MAX_FUNCTIONS', least: 1, most: 1000, example: 32 },
  rebuildsAtOnce: { setting: 'RECALL_MAX_REBUILDS', least: 1, most: 64, example: 4 },
  playbooksAtOnce: { setting: 'RECALL_PLAYBOOKS_AT_ONCE', least: 1, most: 64, example: 4 },
};

export const recallVariables: readonly string[] = Object.values(bounds).map(
  ({ setting }: { readonly setting: string }) => setting,
);

export function readRecallSettings(environment: Environment): Effect.Effect<RecallSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'recall function settings', bounds });
}
