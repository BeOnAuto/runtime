import {
  mayCall,
  permissionRefusalOf,
  roleRefusalDetail,
  type CallerIdentity,
  type Runnable,
  type Unavailable,
} from '@on.auto/operations';
import type { OfferedGroup, OfferedProvider, ProviderOffering } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import { defineAddConnection } from '../operations/add-connection.ts';
import { opensSockets, type ConnectionServices } from '../operations/connection-services.ts';
import { pageOperationsOf } from '../page/page-operations.ts';
import { addingRefusalOf, adderRefusalOf } from '../policy/policy-rules.ts';
import type { ListedProvider } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';

export type OfferingServices = Pick<
  ConnectionServices,
  'providers' | 'providerValues' | 'policy' | 'access' | 'consent' | 'pages' | 'sockets'
>;

function refusalToAdd(
  { access, policy }: OfferingServices,
  { operation, caller }: { readonly operation: Runnable<'org'>; readonly caller: CallerIdentity },
  mayAdd: boolean,
): string | null {
  const notPermitted = mayAdd ? undefined : (permissionRefusalOf(operation.permissions, caller) ?? roleRefusalDetail);
  return notPermitted ?? adderRefusalOf(access, caller)?.detail ?? addingRefusalOf(policy)?.detail ?? null;
}

export function addingRefusedTo(
  services: OfferingServices,
  adding: Runnable<'org'>,
  caller: CallerIdentity,
): Effect.Effect<string | null, Unavailable> {
  return Effect.map(mayCall({ operation: adding, caller, org: caller.org }), (mayAdd) =>
    refusalToAdd(services, { operation: adding, caller }, mayAdd),
  );
}

function isOfferedOneWay({ credentials }: ListedProvider): boolean {
  return credentials.some(({ offered }) => offered);
}

function groupOf({ name, for: purpose }: ListedProvider['credentials'][number]['more'][number]): OfferedGroup {
  return { name, for: purpose };
}

function groupsOfferedBy({ credentials }: ListedProvider): readonly OfferedGroup[] {
  const groups = credentials.filter(({ offered }) => offered).flatMap(({ more }) => more);
  return groups
    .filter((group, index) => groups.findIndex(({ name }) => name === group.name) === index)
    .map((group) => groupOf(group));
}

function offeredOf(listed: ListedProvider, money: ReadonlySet<string>): OfferedProvider {
  const { name, title, description } = listed;
  const more = groupsOfferedBy(listed);
  return {
    name,
    title,
    description,
    ...(money.has(name) ? { handles_money: true } : {}),
    ...(more.length === 0 ? {} : { more }),
  };
}

function handlingMoney({ providers }: OfferingServices['providers']): ReadonlySet<string> {
  return new Set(providers.filter(({ entry }) => entry.handles_money === true).map(({ entry }) => entry.name));
}

function offeredAmong(listed: readonly ListedProvider[], money: ReadonlySet<string>): readonly OfferedProvider[] {
  return listed.filter((provider) => isOfferedOneWay(provider)).map((provider) => offeredOf(provider, money));
}

export function makeProviderOffering(services: ConnectionServices): ProviderOffering {
  const adding = defineAddConnection(services, pageOperationsOf(services).approving.registration).registration;
  return (caller) =>
    Effect.flatMap(addingRefusedTo(services, adding, caller), (refusal) =>
      refusal === null
        ? Effect.map(services.consent.hadSources(studioBaseFor(services.pages)), (consent) =>
            offeredAmong(
              listedProviders({ ...services, consent, opensSockets: opensSockets(services) }),
              handlingMoney(services.providers),
            ),
          )
        : Effect.undefined,
    );
}
