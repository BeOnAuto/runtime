import type { Environment } from '@on.auto/config';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import { readShippedSettings, type ShippedSettings } from '../../settings/served-settings.ts';
import { readSettings, type Settings } from '../../settings/settings.ts';

export const shippedSettings: ShippedSettings = await readShippedSettings(shippedFilesOnDisk);

export function readSettingsOf(environment: Environment): Settings {
  return readSettings(environment, shippedSettings);
}
