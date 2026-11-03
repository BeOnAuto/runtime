import { permissionFor, permissionRefusalOf, type CallerIdentity } from '@on.auto/operations';
import type { OfferedProvider, ProviderOffering } from '@on.auto/tool-servers';
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

function offeredOf({ name, title, description }: ListedProvider, money: ReadonlySet<string>): OfferedProvider {
  return { name, title, description, ...(money.has(name) ? { handles_money: true } : {}) };
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
