import { providerNamed, providersShippedRoots, readProviders, type ProviderEntry } from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

export const shippedProviders = shipped;

export function shippedSlackBot(): ProviderEntry {
  return Result.getOrThrow(providerNamed(shipped, 'slack-bot')).entry;
}
