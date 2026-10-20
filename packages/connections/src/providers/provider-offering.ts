import { permissionFor, permissionRefusalOf, type CallerIdentity } from '@on.auto/operations';
import type { OfferedProvider, ProviderOffering } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { addingRefusalOf, adderRefusalOf } from '../policy/policy-rules.ts';
import type { ListedProvider } from './listed-providers.ts';
import { listedProviders } from './provider-listing.ts';

export type OfferingServices = Pick<
  ConnectionServices,
  'providers' | 'providerValues' | 'policy' | 'access' | 'consent'
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

function offeredOf({ name, title, description }: ListedProvider): OfferedProvider {
  return { name, title, description };
}

function offeredAmong(listed: readonly ListedProvider[]): readonly OfferedProvider[] {
  return listed.filter((provider) => isOfferedOneWay(provider)).map((provider) => offeredOf(provider));
}

export function makeProviderOffering(services: OfferingServices): ProviderOffering {
  return (caller) =>
    refusalToAdd(services, caller) === null
      ? Effect.map(services.consent.hadSources, (consent) => offeredAmong(listedProviders({ ...services, consent })))
      : Effect.undefined;
}
