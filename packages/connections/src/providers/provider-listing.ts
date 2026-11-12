import { isFilledAround, placeholdersIn, textsAroundPlaceholders } from '@on.auto/config';
import { reservedHostKindOf } from '@on.auto/outbound';
import { listed } from '@on.auto/phrasing';
import {
  hostAlternativesOf,
  operatorVariablesOf,
  scopesIn,
  type CredentialWay,
  type Placeholder,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import type { ClientSource, HadSources, WayGateway, WayOAuthClient } from '@on.auto/tool-servers';
import type { Redacted } from 'effect';

import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { hostRefusalOf } from '../policy/policy-rules.ts';
import { consentOfferedOf } from './consent-offered.ts';
import {
  listedWayOf,
  type ListedPlaceholder,
  type ListedProvider,
  type ListedWay,
  type OAuthClientChoice,
} from './listed-providers.ts';

export interface Listing {
  readonly providers: ProviderList;
  readonly policy: ConnectionPolicy;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly consent: HadSources;
}

type Offering = Pick<ListedWay, 'offered' | 'because'>;

const placedHostCharacters = /^[a-z0-9-]+$/u;

function isPlacedInAHost(placed: string): boolean {
  return placedHostCharacters.test(placed);
}

function fitsTheShapeOf(template: string, pattern: string): boolean {
  const around = textsAroundPlaceholders(template).map((text) => text.toLowerCase());
  return isFilledAround(around, pattern, isPlacedInAHost);
}

function fixedTailOf(template: string): string {
  return template.slice(template.lastIndexOf('}') + 1).toLowerCase();
}

function couldBeAllowed(pattern: string, template: string): boolean {
  const lowered = pattern.toLowerCase();
  return lowered.startsWith('*.')
    ? fixedTailOf(template).endsWith(lowered.slice(1))
    : fitsTheShapeOf(template, lowered);
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

interface OAuthClientOffered {
  readonly oauth_client: OAuthClientChoice;
  readonly client_source?: ClientSource;
  readonly because?: string;
}

function gatewayOfferedOf(provider: Provider, way: CredentialWay, listing: Listing, offering: Offering): Offering {
  const offered = consentOfferedOf(provider.entry.name, way, listing.consent);
  if ('because' in offered) {
    return { offered: false, because: offered.because };
  }
  return offering.offered ? { ...offering, ...offered } : offering;
}

function oauthClientOfferedOf(
  provider: Provider,
  way: CredentialWay,
  listing: Listing,
): OAuthClientOffered | undefined {
  if (way.kind !== 'authorization' || way.gateway !== undefined) {
    return undefined;
  }
  if (way.oauth_client !== undefined) {
    return { oauth_client: way.oauth_client };
  }
  const offered = consentOfferedOf(provider.entry.name, way, listing.consent);
  return 'because' in offered ? { oauth_client: 'required', ...offered } : { oauth_client: 'optional', ...offered };
}

function wayOfferingOf(way: CredentialWay, offering: Offering, provider: Provider, listing: Listing) {
  if (way.gateway !== undefined) {
    return gatewayOfferedOf(provider, way, listing, offering);
  }
  const oauthClient = oauthClientOfferedOf(provider, way, listing);
  if (oauthClient === undefined) {
    return offering;
  }
  return offering.offered ? { ...offering, ...oauthClient } : { ...offering, oauth_client: oauthClient.oauth_client };
}

export function declaredGatewayOf({ entry }: Provider): WayGateway | undefined {
  const declared = entry.credentials.find(({ kind, gateway }) => kind === 'authorization' && gateway !== undefined);
  return declared?.gateway === undefined ? undefined : { url: declared.gateway.url };
}

function originsOf(provider: Provider): readonly (readonly [string, string])[] {
  const gateway = declaredGatewayOf(provider);
  const { name } = provider.entry;
  return gateway === undefined
    ? []
    : [new URL(gateway.url).origin, new URL(provider.address).origin].map((origin) => [origin, name]);
}

export function gatewayOriginsOf({ providers }: ProviderList): ReadonlyMap<string, string> {
  return new Map(providers.flatMap((provider) => originsOf(provider)));
}

export function gatewayUnofferedOf(provider: Provider, listing: Listing): string | undefined {
  const [because] = provider.entry.credentials
    .filter(({ gateway }) => gateway !== undefined)
    .map((way) => consentOfferedOf(provider.entry.name, way, listing.consent))
    .flatMap((offered) => ('because' in offered ? [offered.because] : []));
  return because;
}

export function isOfferedWay(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return (
    isListed(provider, way, listing.policy) &&
    offeringOf(provider, listing.providerValues).offered &&
    (way.gateway === undefined || !('because' in consentOfferedOf(provider.entry.name, way, listing.consent)))
  );
}

function isUnderTheOrgsOAuthClientAlone(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return oauthClientOfferedOf(provider, way, listing)?.oauth_client === 'required';
}

export function waysInOrderOf(provider: Provider, listing: Listing): readonly CredentialWay[] {
  const { credentials } = provider.entry;
  const alone = credentials.filter((way) => isUnderTheOrgsOAuthClientAlone(provider, way, listing));
  return [...credentials.filter((way) => !alone.includes(way)), ...alone];
}

export function oauthClientForOf(
  provider: Provider,
  listing: Listing,
  asked: WayOAuthClient | undefined,
): (way: CredentialWay) => WayOAuthClient | undefined {
  return (way) => asked ?? (isUnderTheOrgsOAuthClientAlone(provider, way, listing) ? 'own' : undefined);
}

interface Said {
  readonly scope?: string;
  readonly says?: Readonly<Record<string, string>>;
}

function scopesSaidBy({ scope, says = {} }: Said): readonly { readonly name: string; readonly says: unknown }[] {
  return scopesIn(scope).map((name) => ({ name, says: says[name] }));
}

function moreSaidBy({ more = [] }: CredentialWay) {
  return more.map((group) => ({ name: group.name, for: group.for, scopes: scopesSaidBy(group) }));
}

function listedProviderOf(provider: Provider, listing: Listing): readonly ListedProvider[] {
  const { name, title, description, website, type } = provider.entry;
  const offering = offeringOf(provider, listing.providerValues);
  const ways = waysInOrderOf(provider, listing)
    .filter((way) => isListed(provider, way, listing.policy))
    .map((way) =>
      listedWayOf({
        ...way,
        scopes: scopesSaidBy(way),
        more: moreSaidBy(way),
        ...wayOfferingOf(way, offering, provider, listing),
      }),
    );
  return ways.length === 0
    ? []
    : [{ name, title, description, website, type, credentials: ways, placeholders: placeholdersOf(provider) }];
}

export function listedProviders(listing: Listing): readonly ListedProvider[] {
  return listing.providers.providers.flatMap((provider) => listedProviderOf(provider, listing));
}
