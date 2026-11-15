import { Caller, type Forbidden, type Unavailable } from '@on.auto/operations';
import { providerNamed, type Provider, type ProviderList } from '@on.auto/providers';
import { Effect, Result } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { admittedStartOf } from '../policy/connection-starts.ts';
import { bindsPerson } from '../policy/policy-rules.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { replacedOf } from './replaced-providers.ts';
import type { AddedAgain } from './replaced-reconnections.ts';

type Again = Effect.Effect<AddedAgain | undefined, Forbidden | Unavailable>;

function waitingProviderOf(providers: ProviderList, { connection }: KeptConnection): Provider | undefined {
  return connection.status === 'pending' && connection.provider !== null
    ? Result.getOrUndefined(providerNamed(providers, connection.provider))
    : undefined;
}

function leftWaitingByAnother(
  found: KeptConnection,
  { providers, access }: Pick<ConnectionServices, 'providers' | 'access'>,
  caller: string,
): Provider | undefined {
  return bindsPerson(access) && found.connection.added_by.id !== caller
    ? waitingProviderOf(providers, found)
    : undefined;
}

function takenOverFrom(waiting: Provider | undefined, services: ConnectionServices): Again {
  return waiting === undefined
    ? Effect.undefined
    : Effect.map(admittedStartOf(services, waiting.entry.name), (start) =>
        start === 'an admin' ? { from: waiting, byAnAdmin: true, whilePending: true } : undefined,
      );
}

export function addedAgainOf(
  found: KeptConnection,
  services: ConnectionServices,
): Effect.Effect<AddedAgain | undefined, Forbidden | Unavailable, Caller> {
  const replaced = replacedOf(services.providers, found.connection.provider);
  if (replaced !== undefined) {
    return Effect.map(admittedStartOf(services, replaced.replacement.entry.name), (start) => ({
      from: replaced.replacement,
      byAnAdmin: start === 'an admin',
      whilePending: false,
    }));
  }
  return Effect.flatMap(Effect.service(Caller), ({ id }) =>
    takenOverFrom(leftWaitingByAnother(found, services, id), services),
  );
}
