import { OrgContext, Unavailable } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import type {
  ConnectionServices,
  ManagedServiceAccounts,
  ServiceAccountAsked,
  ServiceAccountFailure,
  ServiceAccountMade,
} from '../operations/connection-services.ts';
import { declaredTokenEndpointOf } from '../providers/way-offerings.ts';
import { actsAsAManagedServiceAccount } from '../registry/exchange-credentials.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { keyEndedBeforeRemoval } from './connection-gateways.ts';
import { exchangeWords } from './exchange-words.ts';

export type ServiceAccounting = Pick<ConnectionServices, 'providers' | 'managedServiceAccounts'>;

type Connection = KeptConnection['connection'];

function tokenEndpointOf(connection: Connection, providers: ProviderList): string {
  const way = wayOfTheConnection(connection, providers);
  return way === undefined ? String(connection.credential.token_endpoint) : declaredTokenEndpointOf(way);
}

interface Providing {
  readonly accounts: ManagedServiceAccounts;
  readonly asked: ServiceAccountAsked;
}

function providingOf(
  connection: Connection,
  org: string,
  { providers, managedServiceAccounts }: ServiceAccounting,
): Providing | undefined {
  const tokenEndpoint = tokenEndpointOf(connection, providers);
  return managedServiceAccounts?.provides(tokenEndpoint) === true
    ? { accounts: managedServiceAccounts, asked: { tokenEndpoint, org, connection: connection.id } }
    : undefined;
}

function heldBy<A>(
  work: (providing: Providing) => Effect.Effect<A, ServiceAccountFailure>,
  refusal: string,
  providing: Providing | undefined,
) {
  const unavailable = new Unavailable({ detail: refusal });
  return providing === undefined ? Effect.fail(unavailable) : Effect.mapError(work(providing), () => unavailable);
}

function isRemovedHere({ connection }: KeptConnection): boolean {
  return connection.status !== 'removed' && actsAsAManagedServiceAccount(connection.credential);
}

function serviceAccountRemovedBefore(
  kept: KeptConnection,
  services: ServiceAccounting,
): Effect.Effect<void, Unavailable, OrgContext> {
  if (!isRemovedHere(kept)) {
    return Effect.void;
  }
  const { connection } = kept;
  return Effect.flatMap(Effect.service(OrgContext), ({ org }) =>
    heldBy(
      ({ accounts, asked }) => accounts.remove(asked),
      exchangeWords.accountUnremoved(connection.name),
      providingOf(connection, org, services),
    ),
  );
}

function isTheSameAccount(left: Connection, right: Connection, providers: ProviderList): boolean {
  return (
    actsAsAManagedServiceAccount(left.credential) &&
    actsAsAManagedServiceAccount(right.credential) &&
    tokenEndpointOf(left, providers) === tokenEndpointOf(right, providers)
  );
}

function nextWaysAccountRemovedBefore(
  kept: KeptConnection,
  services: ServiceAccounting,
): Effect.Effect<void, Unavailable, OrgContext> {
  const { connection, nextWay } = kept;
  if (nextWay === undefined) {
    return Effect.void;
  }
  const next = { ...connection, credential: nextWay.credential };
  return isTheSameAccount(next, connection, services.providers)
    ? Effect.void
    : serviceAccountRemovedBefore({ ...kept, connection: next }, services);
}

export function chosenWaysAccountRemovedBefore(
  kept: KeptConnection,
  services: ServiceAccounting,
): Effect.Effect<void, Unavailable, OrgContext> {
  return kept.connection.status === 'pending'
    ? serviceAccountRemovedBefore(kept, services)
    : nextWaysAccountRemovedBefore(kept, services);
}

export function replacedServiceAccountRemovedOf(
  before: KeptConnection,
  after: KeptConnection,
  services: ServiceAccounting,
): Effect.Effect<void, never, OrgContext> {
  return isTheSameAccount(before.connection, after.connection, services.providers)
    ? Effect.void
    : serviceAccountRemovedBefore(before, services).pipe(
        Effect.catch(() =>
          Effect.logError(exchangeWords.replacedAccountUnremoved).pipe(
            Effect.annotateLogs({ token_endpoint: tokenEndpointOf(before.connection, services.providers) }),
          ),
        ),
      );
}

export function endedBeforeRemoval(
  kept: KeptConnection,
  services: ServiceAccounting & Parameters<typeof keyEndedBeforeRemoval>[1],
): Effect.Effect<void, Unavailable, OrgContext> {
  return Effect.andThen(
    keyEndedBeforeRemoval(kept, services),
    Effect.andThen(serviceAccountRemovedBefore(kept, services), nextWaysAccountRemovedBefore(kept, services)),
  );
}

export function serviceAccountMadeFor(
  { connection }: KeptConnection,
  services: ServiceAccounting,
): Effect.Effect<ServiceAccountMade, Unavailable, OrgContext> {
  return Effect.flatMap(Effect.service(OrgContext), ({ org }) =>
    heldBy(
      ({ accounts, asked }) => accounts.create(asked),
      exchangeWords.accountUnmade(connection.name),
      providingOf(connection, org, services),
    ),
  );
}
