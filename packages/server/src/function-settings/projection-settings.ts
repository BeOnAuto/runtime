import type { Environment } from '@on.auto/config';
import { pageViewsBounds, projectorBounds } from '@on.auto/workflow-host';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface ProjectionSettings {
  readonly pageRebuildsAtOnce: number;
  readonly playbooksAtOnce: number;
}

const bounds = {
  pageRebuildsAtOnce: { setting: 'PAGE_MAX_REBUILDS', least: 1, most: 64, example: pageViewsBounds.rebuildsAtOnce },
  playbooksAtOnce: {
    setting: 'PROJECTION_PLAYBOOKS_AT_ONCE',
    least: 1,
    most: 64,
    example: projectorBounds.playbooksAtOnce,
  },
};

export const projectionVariables: readonly string[] = Object.values(bounds).map(
  ({ setting }: { readonly setting: string }) => setting,
);

export function readProjectionSettings(
  environment: Environment,
): Effect.Effect<ProjectionSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'projection settings', bounds });
}
