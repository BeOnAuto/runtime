import type { Environment } from '@on.auto/config';
import type { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface DocumentSettings {
  readonly processes: number;
}

const processes = { setting: 'DOCUMENT_PROCESSES', least: 1, most: 64, example: 2 };

export const documentVariables: readonly string[] = [processes.setting];

export function readDocumentSettings(environment: Environment): Effect.Effect<DocumentSettings, InvalidSettingsError> {
  return countsIn(environment, { settings: 'document settings', bounds: { processes } });
}
