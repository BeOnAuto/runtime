import { readProviders } from '@on.auto/providers';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Result } from 'effect';

import type { ShippedSettings } from './served-settings.ts';

export async function readShippedSettings(shippedFiles: ShippedFiles): Promise<ShippedSettings> {
  return { providers: Result.getOrThrow(await readProviders(shippedFiles)) };
}
