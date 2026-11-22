import { providerFoundBy, type LoopConnection, type ProviderList } from '@on.auto/providers';

import type { KeptConnection } from '../registry/registry.ts';

export function placeNamingOf(
  providers: ProviderList,
  { connection, placeNames }: Pick<KeptConnection, 'connection' | 'placeNames'>,
): LoopConnection['placeNaming'] {
  const types = providerFoundBy(providers, connection.provider)?.entry.events?.types ?? [];
  const naming = types.flatMap(({ type, subject }) =>
    subject?.name === undefined ? [] : [{ type, name: subject.name, named: [...(placeNames.get(type)?.keys() ?? [])] }],
  );
  return connection.status !== 'connected' || naming.length === 0 ? undefined : naming;
}
