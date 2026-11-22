import type { Environment } from '@on.auto/config';
import { readProviders } from '@on.auto/providers';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Result } from 'effect';

import type { ShippedSettings } from './served-settings.ts';
import { readSettings, type Settings } from './settings.ts';

export async function readShippedSettings(shippedFiles: ShippedFiles): Promise<ShippedSettings> {
  return { providers: Result.getOrThrow(await readProviders(shippedFiles)) };
}

export async function settingsAtStart(
  environment: Environment,
  shippedFiles: ShippedFiles,
  defaults?: Parameters<typeof readSettings>[2],
  shipped?: ShippedSettings,
): Promise<Settings> {
  return readSettings(environment, shipped ?? (await readShippedSettings(shippedFiles)), defaults);
}
