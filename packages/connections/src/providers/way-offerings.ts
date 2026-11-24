import { listed } from '@on.auto/phrasing';
import {
  isAManagedServiceAccount,
  operatorVariablesOf,
  type CredentialWay,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import type { Redacted } from 'effect';

import { replacedOf, replacedWayWords } from '../replacements/replaced-providers.ts';
import type { ListedWay } from './listed-providers.ts';

export type Offering = Pick<ListedWay, 'offered' | 'because'>;

interface Offered {
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

function setUpFirst({ entry }: Provider, providerValues: Offered['providerValues']): Offering {
  const unset = operatorVariablesOf(entry).filter((variable) => !providerValues.has(variable));
  return unset.length === 0
    ? { offered: true }
    : {
        offered: false,
        because: `Whoever runs the runtime sets this up first: it sends ${listed(unset)}, which this runtime does not set`,
      };
}

export function offeringOf(provider: Provider, { providers, providerValues }: Offered): Offering {
  const replaced = replacedOf(providers, provider.entry.name);
  return replaced === undefined
    ? setUpFirst(provider, providerValues)
    : { offered: false, because: replacedWayWords(replaced) };
}

export interface Exchanging {
  readonly subjectTokens?: unknown;
  readonly managedServiceAccounts?: { readonly provides: (tokenEndpoint: string) => boolean };
}

export function declaredTokenEndpointOf(way: Pick<CredentialWay, 'token_endpoint'>): string {
  return String(way.token_endpoint);
}

export function exchangesHere(way: CredentialWay, { subjectTokens, managedServiceAccounts }: Exchanging): boolean {
  if (way.kind !== 'token_exchange') {
    return true;
  }
  return (
    subjectTokens !== undefined &&
    (!isAManagedServiceAccount(way) || managedServiceAccounts?.provides(declaredTokenEndpointOf(way)) === true)
  );
}

const managedListed = { service_account: 'managed' } as const;

export function serviceAccountListedOf(way: CredentialWay): { readonly service_account?: 'managed' } {
  return isAManagedServiceAccount(way) ? managedListed : {};
}
