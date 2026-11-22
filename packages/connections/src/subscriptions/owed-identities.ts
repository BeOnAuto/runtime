import { providerFoundBy, type LoopConnection, type ProviderList } from '@on.auto/providers';

import type { KeptConnection } from '../registry/registry.ts';

export function identityOwedBy(
  providers: ProviderList,
  { connection, identified }: Pick<KeptConnection, 'connection' | 'identified'>,
): LoopConnection['identify'] {
  const identity = providerFoundBy(providers, connection.provider)?.entry.events?.identity;
  return identified !== undefined || connection.status !== 'connected' ? undefined : identity;
}
