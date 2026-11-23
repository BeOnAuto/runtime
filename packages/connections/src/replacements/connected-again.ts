import type { Forbidden, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { admittedStartOf } from '../policy/connection-starts.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { replacedOf } from './replaced-providers.ts';
import type { AddedAgain } from './replaced-reconnections.ts';

export function addedAgainOf(
  found: KeptConnection,
  services: ConnectionServices,
): Effect.Effect<AddedAgain | undefined, Forbidden | Unavailable> {
  const replaced = replacedOf(services.providers, found.connection.provider);
  return replaced === undefined
    ? Effect.undefined
    : Effect.as(admittedStartOf(services, replaced.replacement.entry.name), { from: replaced.replacement });
}
