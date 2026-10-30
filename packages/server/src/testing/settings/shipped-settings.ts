import type { Environment } from '@on.auto/config';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { providersShippedRoots } from '@on.auto/providers';

import { readShippedSettings, type ShippedSettings } from '../../settings/served-settings.ts';
import { readSettings, type Settings } from '../../settings/settings.ts';

const providersFiles = shippedFilesOnDisk(providersShippedRoots());

export const shippedSettings: ShippedSettings = await readShippedSettings(providersFiles);

export function readSettingsOf(environment: Environment): Settings {
  return readSettings(environment, shippedSettings);
}
