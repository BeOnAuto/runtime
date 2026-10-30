import { placeholdersIn, placeholdersReplaced } from '@on.auto/config';
import { listed } from '@on.auto/operations';
import { reservedHostKindOf } from '@on.auto/outbound';
import {
  hostAlternativesOf,
  operatorVariablesOf,
  scopesIn,
  type CredentialWay,
  type Placeholder,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import type { HadSources, WayApp } from '@on.auto/tool-servers';
import type { Redacted } from 'effect';

import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { hostRefusalOf } from '../policy/policy-rules.ts';
import { consentUnsetUpOf } from './consent-offered.ts';
import {
  listedWayOf,
  type ListedPlaceholder,
  type ListedProvider,
  type ListedWay,
  type OwnAppChoice,
} from './listed-providers.ts';

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

interface OwnAppOffered {
  readonly own_app: OwnAppChoice;
  readonly because?: string;
}

function ownAppOfferedOf(provider: Provider, way: CredentialWay, listing: Listing): OwnAppOffered | undefined {
  if (way.kind !== 'authorization') {
    return undefined;
  }
  if (way.own_app !== undefined) {
    return { own_app: way.own_app };
  }
  const unsetUp = consentUnsetUpOf(provider.entry.name, way, listing.consent);
  return unsetUp === undefined ? { own_app: 'optional' } : { own_app: 'required', because: unsetUp };
}

function wayOfferingOf(way: CredentialWay, offering: Offering, provider: Provider, listing: Listing) {
  const ownApp = ownAppOfferedOf(provider, way, listing);
  if (ownApp === undefined) {
    return offering;
  }
  return offering.offered ? { ...offering, ...ownApp } : { ...offering, own_app: ownApp.own_app };
}

export function isOfferedWay(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return isListed(provider, way, listing.policy) && offeringOf(provider, listing.providerValues).offered;
}

function isUnderTheOrgsAppAlone(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return ownAppOfferedOf(provider, way, listing)?.own_app === 'required';
}

export function waysInOrderOf(provider: Provider, listing: Listing): readonly CredentialWay[] {
  const { credentials } = provider.entry;
  const alone = credentials.filter((way) => isUnderTheOrgsAppAlone(provider, way, listing));
  return [...credentials.filter((way) => !alone.includes(way)), ...alone];
}

export function appForOf(
  provider: Provider,
  listing: Listing,
  asked: WayApp | undefined,
): (way: CredentialWay) => WayApp | undefined {
  return (way) => asked ?? (isUnderTheOrgsAppAlone(provider, way, listing) ? 'own' : undefined);
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
