import { placeholdersIn, placeholdersReplaced } from '@on.auto/config';
import { listed } from '@on.auto/operations';
import { reservedHostKindOf } from '@on.auto/outbound';
import {
  hostAlternativesOf,
  operatorVariablesOf,
  type CredentialWay,
  type Placeholder,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import type { HadSources } from '@on.auto/tool-servers';
import type { Redacted } from 'effect';

import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { hostRefusalOf } from '../policy/policy-rules.ts';
import { consentUnsetUp, isConsentUnsetUp } from './consent-offered.ts';
import { listedWayOf, type ListedPlaceholder, type ListedProvider, type ListedWay } from './listed-providers.ts';

export interface Listing {
  readonly providers: ProviderList;
  readonly policy: ConnectionPolicy;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly consent: HadSources;
}

type Offering = Pick<ListedWay, 'offered' | 'because'>;

const placedHostCharacters = '[a-z0-9-]+';

const between = '\n';

function shapeOf(template: string): RegExp {
  const fixed = placeholdersReplaced(template, () => between)
    .toLowerCase()
    .split(between);
  return new RegExp(`^${fixed.map((part) => RegExp.escape(part)).join(placedHostCharacters)}$`, 'u');
}

function fixedTailOf(template: string): string {
  return template.slice(template.lastIndexOf('}') + 1).toLowerCase();
}

function couldBeAllowed(pattern: string, template: string): boolean {
  const lowered = pattern.toLowerCase();
  return lowered.startsWith('*.') ? fixedTailOf(template).endsWith(lowered.slice(1)) : shapeOf(template).test(lowered);
}

function couldReach(allowedHosts: readonly string[] | null, host: string): boolean {
  if (allowedHosts === null) {
    return placeholdersIn(host).length > 0 || reservedHostKindOf(host) === undefined;
  }
  return placeholdersIn(host).length === 0
    ? hostRefusalOf(allowedHosts, host.toLowerCase()) === undefined
    : allowedHosts.some((pattern) => couldBeAllowed(pattern, host));
}

function isListed(
  provider: Provider,
  way: CredentialWay,
  { allowedHosts, credentialKinds }: ConnectionPolicy,
): boolean {
  return (
    (credentialKinds === null || credentialKinds.includes(way.kind)) &&
    hostAlternativesOf(provider, way).some((hosts) => hosts.every((host) => couldReach(allowedHosts, host)))
  );
}

function offeringOf({ entry }: Provider, providerValues: ReadonlyMap<string, Redacted.Redacted>): Offering {
  const unset = operatorVariablesOf(entry).filter((variable) => !providerValues.has(variable));
  return unset.length === 0
    ? { offered: true }
    : {
        offered: false,
        because: `Whoever runs the runtime sets this up first: it sends ${listed(unset)}, which this runtime does not set`,
      };
}

function listedPlaceholderOf([name, placeholder]: readonly [string, Placeholder]): ListedPlaceholder {
  const { description, pattern, example, required = true, choices } = placeholder;
  return {
    name,
    description,
    ...(pattern === undefined ? {} : { pattern }),
    ...(example === undefined ? {} : { example }),
    required,
    ...(choices === undefined ? {} : { choices: choices.map(({ value, title }) => ({ value, title })) }),
  };
}

function placeholdersOf({ entry }: Provider): readonly ListedPlaceholder[] {
  return Object.entries(entry.placeholders ?? {}).map((each: readonly [string, Placeholder]) =>
    listedPlaceholderOf(each),
  );
}

function wayOfferingOf(way: CredentialWay, offering: Offering, { entry }: Provider, listing: Listing): Offering {
  return offering.offered && isConsentUnsetUp(way, listing.consent)
    ? { offered: false, because: consentUnsetUp(entry.name) }
    : offering;
}

export function isOfferedWay(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return (
    isListed(provider, way, listing.policy) &&
    wayOfferingOf(way, offeringOf(provider, listing.providerValues), provider, listing).offered
  );
}

function listedProviderOf(provider: Provider, listing: Listing): readonly ListedProvider[] {
  const { name, title, description, website, type, credentials } = provider.entry;
  const offering = offeringOf(provider, listing.providerValues);
  const ways = credentials
    .filter((way) => isListed(provider, way, listing.policy))
    .map((way) => listedWayOf({ ...way, ...wayOfferingOf(way, offering, provider, listing) }));
  return ways.length === 0
    ? []
    : [{ name, title, description, website, type, credentials: ways, placeholders: placeholdersOf(provider) }];
}

export function listedProviders(listing: Listing): readonly ListedProvider[] {
  return listing.providers.providers.flatMap((provider) => listedProviderOf(provider, listing));
}
