import {
  accountTypesOf,
  addressGivenWholeIn,
  hostAlternativesOf,
  permissionsOf,
  replacedNamesOf,
  scopesIn,
  type AppCredential,
  type CredentialWay,
  type EventDestination,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import type { ClientSource, HadSources, WayGateway, WayOAuthClient } from '@on.auto/tool-servers';
import { Struct, type Redacted } from 'effect';

import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import type { ChatOffered } from '../registry/connection-commands.ts';
import { chatThroughOf, type ChatAnswering, type ChatHosting } from './chat-answers.ts';
import { consentOfferedOf } from './consent-offered.ts';
import {
  listedPlaceholdersOf,
  listedWayOf,
  wayPlaceholdersOf,
  type ListedProvider,
  type OAuthClientChoice,
} from './listed-providers.ts';
import { couldReach, couldReachAnyHost } from './provider-host-reach.ts';
import { offeringOf, type Offering } from './way-offerings.ts';

export interface Listing {
  readonly providers: ProviderList;
  readonly policy: ConnectionPolicy;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
  readonly consent: HadSources;
}

interface ListedChats {
  readonly throughAGateway: boolean;
  readonly answering: ChatAnswering;
}

interface ListingOfTheRuntime extends Listing {
  readonly opensSockets: boolean;
  readonly chats?: ListedChats;
}

function isListed(provider: Provider, way: CredentialWay, policy: ConnectionPolicy): boolean {
  const { credentialKinds } = policy;
  const givenWhole = addressGivenWholeIn(provider.entry);
  const reachable = (host: string) =>
    givenWhole !== undefined && host === `{${givenWhole}}` ? couldReachAnyHost(policy) : couldReach(policy, host);
  return (
    (credentialKinds === null || credentialKinds.includes(way.kind)) &&
    hostAlternativesOf(provider, way).some((hosts) => hosts.every((host) => reachable(host)))
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
    offeringOf(provider, listing).offered &&
    (way.gateway === undefined || !('because' in consentOfferedOf(provider.entry.name, way, listing.consent)))
  );
}

function isUnderTheOrgsOAuthClientAlone(provider: Provider, way: CredentialWay, listing: Listing): boolean {
  return oauthClientOfferedOf(provider, way, listing)?.oauth_client === 'required';
}

function asksValuesOfItsOwn({ placeholders }: CredentialWay): boolean {
  return placeholders !== undefined;
}

export function waysInOrderOf(provider: Provider, listing: Listing): readonly CredentialWay[] {
  const { credentials } = provider.entry;
  const ofItsOwnValues = credentials.filter((way) => asksValuesOfItsOwn(way));
  const alone = credentials.filter(
    (way) => !ofItsOwnValues.includes(way) && isUnderTheOrgsOAuthClientAlone(provider, way, listing),
  );
  const later = [...alone, ...ofItsOwnValues];
  return [...credentials.filter((way) => !later.includes(way)), ...later];
}

export function oauthClientForOf(
  provider: Provider,
  listing: Listing,
  asked?: WayOAuthClient,
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

export interface OfferedAppCredential {
  readonly credential: AppCredential;
  readonly destination: EventDestination;
}

function socketsByCredentialOf({ entry }: Provider): ReadonlyMap<string | undefined, EventDestination> {
  const sockets = (entry.events?.destinations ?? []).filter(({ type }) => type === 'websocket');
  return new Map(sockets.map((destination) => [destination.credential, destination]));
}

export function offeredAppCredentialsOf(
  provider: Provider,
  way: CredentialWay,
  { opensSockets }: Pick<ListingOfTheRuntime, 'opensSockets'>,
): readonly OfferedAppCredential[] {
  if (!opensSockets) {
    return [];
  }
  const sockets = socketsByCredentialOf(provider);
  return (way.app_credentials ?? []).flatMap((credential) => {
    const destination = sockets.get(credential.name);
    return destination === undefined ? [] : [{ credential, destination }];
  });
}

export function chatOfferedOn(provider: Provider, way: CredentialWay, hosting: ChatHosting): ChatOffered | undefined {
  if (hosting.throughAGateway && way.gateway !== undefined) {
    return { through: 'gateway' };
  }
  const opening =
    provider.entry.chat === undefined
      ? undefined
      : offeredAppCredentialsOf(provider, way, hosting).find(({ destination }) => destination.chat !== undefined);
  return opening === undefined
    ? undefined
    : { through: 'app_credential', credential: opening.credential.name, label: opening.credential.description };
}

function chatListedOf(provider: Provider, way: CredentialWay, { opensSockets, chats }: ListingOfTheRuntime) {
  if (chats === undefined) {
    return {};
  }
  const { throughAGateway, answering } = chats;
  const offered = chatOfferedOn(provider, way, { opensSockets, throughAGateway });
  return offered === undefined ? {} : { chat: { ...chatThroughOf(offered, answering), may_set_model: answering.may } };
}

function actingOf(way: CredentialWay) {
  const permissions = permissionsOf(way);
  const accountTypes = accountTypesOf(way);
  return {
    ...(permissions === undefined ? {} : { permissions }),
    ...(accountTypes.length === 0 ? {} : { account_types: accountTypes }),
  };
}

function keyFileListedOf({ key_file: keyFile }: CredentialWay) {
  return keyFile === undefined ? {} : { key_file: { format: keyFile.format ?? 'json' } };
}

function appCredentialsListedOf(provider: Provider, way: CredentialWay, listing: ListingOfTheRuntime) {
  const offered = offeredAppCredentialsOf(provider, way, listing);
  return offered.length === 0 ? {} : { app_credentials: offered.map(({ credential }) => credential) };
}

function listedProviderOf(provider: Provider, listing: ListingOfTheRuntime): readonly ListedProvider[] {
  const { name, title, description, summary, website, type, replaces } = provider.entry;
  const replaced = replaces === undefined ? {} : { replaces: replacedNamesOf(listing.providers, provider.entry) };
  const offering = offeringOf(provider, listing);
  const ways = waysInOrderOf(provider, listing)
    .filter((way) => isListed(provider, way, listing.policy))
    .map((way) =>
      listedWayOf({
        ...Struct.omit(way, [
          'app_credentials',
          'test',
          'permissions',
          'account_types',
          'placeholders',
          'subject',
          'key_file',
          'client_id',
          'token_request',
        ]),
        ...actingOf(way),
        ...keyFileListedOf(way),
        ...wayPlaceholdersOf(way),
        ...appCredentialsListedOf(provider, way, listing),
        ...chatListedOf(provider, way, listing),
        scopes: scopesSaidBy(way),
        more: moreSaidBy(way),
        ...wayOfferingOf(way, offering, provider, listing),
      }),
    );
  return ways.length === 0
    ? []
    : [
        {
          name,
          title,
          description,
          ...(summary === undefined ? {} : { summary }),
          website,
          type,
          credentials: ways,
          placeholders: listedPlaceholdersOf(provider.entry.placeholders),
          ...replaced,
        },
      ];
}

export function listedProviders(listing: ListingOfTheRuntime): readonly ListedProvider[] {
  return listing.providers.providers.flatMap((provider) => listedProviderOf(provider, listing));
}
