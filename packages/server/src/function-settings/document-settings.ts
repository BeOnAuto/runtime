import type { Environment } from '@on.auto/config';
import { Effect } from 'effect';

import type { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn, type CountBounds } from './counted-settings.ts';

export interface DocumentSettings {
  readonly processes: number;
  readonly processMemoryMebibytes: number;
  readonly path: string | undefined;
}

const processes: CountBounds = { setting: 'DOCUMENT_PROCESSES', least: 1, most: 64, example: 2 };

const processMemoryMebibytes: CountBounds = {
  setting: 'DOCUMENT_PROCESS_MEMORY',
  least: 768,
  most: 16_384,
  example: 1280,
};

export const documentVariables: readonly string[] = [processes.setting, processMemoryMebibytes.setting, 'PATH'];

export function readDocumentSettings(environment: Environment): Effect.Effect<DocumentSettings, InvalidSettingsError> {
  return Effect.map(
    countsIn(environment, { settings: 'document settings', bounds: { processes, processMemoryMebibytes } }),
    (counts) => ({ ...counts, path: environment['PATH'] }),
  );
}
