import { permissionFor, permissionRefusalOf, type CallerIdentity } from '@on.auto/operations';
import type { OfferedGroup, OfferedProvider, ProviderOffering } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { addingRefusalOf, adderRefusalOf } from '../policy/policy-rules.ts';
import type { ListedProvider } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';

export type OfferingServices = Pick<
  ConnectionServices,
  'providers' | 'providerValues' | 'policy' | 'access' | 'consent' | 'pages'
>;

const addingPermissions = [permissionFor('command', 'org')];

export function refusalToAdd({ access, policy }: OfferingServices, caller: CallerIdentity): string | null {
  return (
    permissionRefusalOf(addingPermissions, caller) ??
    adderRefusalOf(access, caller)?.detail ??
    addingRefusalOf(policy)?.detail ??
    null
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

export function makeProviderOffering(services: OfferingServices): ProviderOffering {
  return (caller) =>
    refusalToAdd(services, caller) === null
      ? Effect.map(services.consent.hadSources(studioBaseFor(services.pages)), (consent) =>
          offeredAmong(listedProviders({ ...services, consent }), handlingMoney(services.providers)),
        )
      : Effect.undefined;
}
