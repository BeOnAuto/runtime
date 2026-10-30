import type { AppRuntime } from '@on.auto/api';
import type { ExtensionPoint } from '@on.auto/definitions';
import type { DispatcherServices } from '@on.auto/operations';

import { logExtensions } from '../logging/extension-logging.ts';
import {
  installedPackages,
  listedExtensions,
  loadedExtensions,
  type InstalledPackages,
  type LoadedExtensions,
} from './extension-loading.ts';
import type { ExtensionEntry } from './extension-settings.ts';
import { releaseExtensions } from './release-extensions.ts';

export async function extensionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  configured: readonly ExtensionEntry[],
  points: readonly ExtensionPoint[],
  installed: InstalledPackages = installedPackages,
): Promise<LoadedExtensions> {
  const extensions = await loadedExtensions(listedExtensions(configured, releaseExtensions), points, installed);
  await runtime.run(logExtensions(extensions.extensions));
  return extensions;
}
