import type { AppRuntime } from '@on.auto/api';
import type { ExtensionPoint } from '@on.auto/definitions';
import type { DispatcherServices } from '@on.auto/operations';

import { logExtensions } from '../logging/extension-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { predictionCapabilityFilled, predictionCapabilityOf, type FilledPoint } from './capability-points.ts';
import { installedPackages, listedExtensions, loadedExtensions, type InstalledPackages } from './extension-loading.ts';
import { ownSettingsOf } from './extension-settings.ts';
import { releaseExtensions } from './release-extensions.ts';

const pointsTheCapabilitiesDeclare: readonly ExtensionPoint[] = [predictionCapabilityFilled];

export interface ServedExtensions {
  readonly makePrediction: FilledPoint;
  readonly logged: (runtime: AppRuntime<DispatcherServices>) => Promise<void>;
}

export async function extensionsServedBy(
  { extensions: configured, extensionSettings }: Pick<Settings, 'extensions' | 'extensionSettings'>,
  installed: InstalledPackages = installedPackages,
): Promise<ServedExtensions> {
  const { extensions, provided } = await loadedExtensions(
    listedExtensions(configured, releaseExtensions),
    pointsTheCapabilitiesDeclare,
    installed,
  );
  const makePrediction = predictionCapabilityOf(provided, (extension) => ownSettingsOf(extensionSettings, extension));
  return {
    makePrediction,
    logged: async (runtime) => {
      await runtime.run(logExtensions(extensions));
    },
  };
}
