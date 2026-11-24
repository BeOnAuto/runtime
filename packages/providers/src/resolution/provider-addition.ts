import type { Issue } from '@on.auto/operations';
import {
  isPinnableUrl,
  pinnedUrlShape,
  type ClientSource,
  type TokenExchange,
  type TokenRequest,
  type WayOAuthClient,
} from '@on.auto/tool-servers';
import { Option, Result } from 'effect';

import type { CredentialWay, WayKind } from '../entry/credential-ways.ts';
import { isRequired, type Placeholder } from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { wayAddresses, type WayAddress, type WayAddresses } from '../entry/templates.ts';
import { keyFieldNames, type KeyFieldName } from '../keys/key-fields.ts';
import { actingOf, chosenWayOf, type Acting, type WayAsked } from './chosen-ways.ts';
import { placedText, valuesOf, type Values } from './placeholder-values.ts';

export interface GivenToProvider extends WayAsked {
  readonly name?: string | undefined;
  readonly placeholders?: Readonly<Record<string, string>> | undefined;
  readonly oauthClientFor?: ((way: CredentialWay) => WayOAuthClient | undefined) | undefined;
  readonly playbooks?: readonly string[] | undefined;
  readonly allowed?: readonly string[] | undefined;
  readonly record_content?: boolean | undefined;
}

export interface ProviderCredential extends WayAddresses, Partial<Readonly<Record<KeyFieldName, string>>> {
  readonly kind: WayKind;
  readonly in?: NonNullable<CredentialWay['in']>;
  readonly name?: string;
  readonly scheme?: string;
  readonly scope?: string;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly pkce?: NonNullable<CredentialWay['pkce']>;
  readonly clients?: NonNullable<CredentialWay['clients']>;
  readonly client_source?: Extract<ClientSource, 'own' | 'gateway'>;
  readonly subject?: string;
  readonly client_id?: string;
  readonly token_request?: TokenRequest;
  readonly installation?: NonNullable<CredentialWay['installation']>;
  readonly service_account?: 'managed';
}

export interface ProviderConnectionEntry {
  readonly url?: string;
  readonly document?: string;
  readonly base_url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly request_id?: string;
  readonly playbooks?: readonly string[];
  readonly allowed?: readonly string[];
  readonly record_content?: boolean;
}

export interface ProviderAddition extends Acting {
  readonly name: string;
  readonly type: ProviderEntry['type'];
  readonly entry: ProviderConnectionEntry;
  readonly credential: ProviderCredential;
  readonly provider: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly says?: Readonly<Record<string, string>>;
}

type Placed = Readonly<Record<string, string>>;

function placedAddressesOf(way: CredentialWay, values: Values): Partial<Record<WayAddress, string>> {
  return Object.fromEntries(
    wayAddresses.flatMap((field) => {
      const written = way[field];
      return written === undefined ? [] : [[field, placedText(written, values)]];
    }),
  );
}

const underTheOrgsOAuthClient: Pick<ProviderCredential, 'client_source'> = { client_source: 'own' };

const throughItsGateway: Pick<ProviderCredential, 'client_source'> = { client_source: 'gateway' };

function clientSourceOf({ kind, oauth_client: required, gateway }: CredentialWay, asked: WayOAuthClient | undefined) {
  if (gateway !== undefined) {
    return throughItsGateway;
  }
  return kind === 'authorization' && (asked !== undefined || required !== undefined) ? underTheOrgsOAuthClient : {};
}

function oauthClientRefusalOf(
  provider: string,
  way: CredentialWay,
  asked: WayOAuthClient | undefined,
): readonly Issue[] {
  return way.gateway === undefined || asked === undefined
    ? []
    : [
        {
          pointer: '/credential/oauth_client',
          detail: `Expected no oauth_client: the provider ${provider} connects through a gateway, which makes the consent with a client of its own`,
        },
      ];
}

function chosenOf(
  provider: string,
  way: CredentialWay,
  oauthClient: WayOAuthClient | undefined,
): Result.Result<CredentialWay, readonly Issue[]> {
  const refusal = oauthClientRefusalOf(provider, way, oauthClient);
  return refusal.length === 0 ? Result.succeed(way) : Result.fail(refusal);
}

function keyFieldsOf(way: CredentialWay): Partial<Record<KeyFieldName, string>> {
  if (way.kind !== 'secret') {
    return {};
  }
  return Object.fromEntries(
    keyFieldNames.flatMap((field) => {
      const written = way[field];
      return written === undefined ? [] : [[field, written]];
    }),
  );
}

function placedEach(written: Placed, values: Values): Placed {
  return Object.fromEntries(
    Object.entries(written).map(([name, text]: readonly [string, string]) => [name, placedText(text, values)]),
  );
}

function assertedOf(
  way: CredentialWay,
  values: Values,
): Pick<ProviderCredential, 'subject' | 'client_id' | 'token_request' | 'installation'> {
  const { subject, client_id: clientId, token_request: request, installation } = way;
  return {
    ...(installation === undefined ? {} : { installation }),
    ...(subject === undefined ? {} : { subject: placedText(subject, values) }),
    ...(clientId === undefined ? {} : { client_id: placedText(clientId, values) }),
    ...(request === undefined ? {} : { token_request: { ...request, url: placedText(request.url, values) } }),
  };
}

const ofAManagedServiceAccount: Pick<ProviderCredential, 'service_account'> = { service_account: 'managed' };

function credentialOf(way: CredentialWay, values: Values, oauthClient: WayOAuthClient | undefined): ProviderCredential {
  const { kind, in: placement, name, scheme, scope, parameters, pkce, clients } = way;
  return {
    kind,
    ...(way.managed_service_account === true ? ofAManagedServiceAccount : {}),
    ...clientSourceOf(way, oauthClient),
    ...(placement === undefined ? {} : { in: placement }),
    ...(name === undefined ? {} : { name }),
    ...(scheme === undefined ? {} : { scheme }),
    ...keyFieldsOf(way),
    ...placedAddressesOf(way, values),
    ...(scope === undefined ? {} : { scope }),
    ...(parameters === undefined ? {} : { parameters: placedEach(parameters, values) }),
    ...(pkce === undefined ? {} : { pkce }),
    ...(clients === undefined ? {} : { clients }),
    ...assertedOf(way, values),
  };
}

function isLeftOut(text: string, placeholders: Readonly<Record<string, Placeholder>>, values: Values): boolean {
  return Object.entries(placeholders).some(
    ([name, placeholder]: readonly [string, Placeholder]) =>
      text === `{${name}}` && !isRequired(placeholder) && !values.given.has(name),
  );
}

function placedValues(written: Placed, entry: ProviderEntry, values: Values): Placed {
  return Object.fromEntries(
    Object.entries(written)
      .filter(([, text]: readonly [string, string]) => !isLeftOut(text, entry.placeholders ?? {}, values))
      .map(([key, text]: readonly [string, string]) => [key, placedText(text, values)]),
  );
}

function serverOf(entry: ProviderEntry, way: CredentialWay, values: Values): ProviderConnectionEntry {
  const { url, document, headers, query_params: query, request_id: requestId } = entry;
  const baseUrl = way.base_url ?? entry.base_url;
  return {
    ...(url === undefined ? {} : { url: placedText(url, values) }),
    ...(document === undefined ? {} : { document: placedText(document, values) }),
    ...(baseUrl === undefined ? {} : { base_url: placedText(baseUrl, values) }),
    ...(headers === undefined ? {} : { headers: placedValues(headers, entry, values) }),
    ...(query === undefined ? {} : { query_params: placedValues(query, entry, values) }),
    ...(requestId === undefined ? {} : { request_id: requestId }),
  };
}

function perConnectionOf({
  playbooks,
  allowed,
  record_content: recordContent,
}: GivenToProvider): ProviderConnectionEntry {
  return {
    ...(playbooks === undefined ? {} : { playbooks }),
    ...(allowed === undefined ? {} : { allowed }),
    ...(recordContent === undefined ? {} : { record_content: recordContent }),
  };
}

function placingIssuesOf(provider: ProviderEntry, placeholders: Placed): readonly Issue[] {
  return Result.getFailure(valuesOf(provider, undefined, placeholders)).pipe(
    Option.getOrElse((): readonly Issue[] => []),
  );
}

function wayAskingItsValues(way: CredentialWay): CredentialWay | undefined {
  return way.managed_service_account === true ? undefined : way;
}

export function additionOfProvider(
  provider: ProviderEntry,
  given: GivenToProvider,
): Result.Result<ProviderAddition, readonly Issue[]> {
  const placeholders = given.placeholders ?? {};
  return Result.match(chosenWayOf(provider, given), {
    onFailure: (refused) => Result.fail([...placingIssuesOf(provider, placeholders), ...refused]),
    onSuccess: (offered) =>
      Result.flatMap(valuesOf(provider, wayAskingItsValues(offered), placeholders), (values) => {
        const oauthClient = given.oauthClientFor?.(offered);
        return Result.map(chosenOf(provider.name, offered, oauthClient), (chosen) => ({
          name: given.name ?? provider.name,
          type: provider.type,
          entry: { ...serverOf(provider, chosen, values), ...perConnectionOf(given) },
          credential: credentialOf(chosen, values, oauthClient),
          provider: provider.name,
          placeholders,
          ...(chosen.says === undefined ? {} : { says: chosen.says }),
          ...actingOf(chosen),
        }));
      }),
  });
}

export interface PlacedExchange extends TokenExchange {
  readonly scope: string | undefined;
}

function exchangeWrittenIn(way: CredentialWay, values: Values): PlacedExchange {
  const { parameters, impersonation, scope } = way;
  const subjectToken = Option.getOrThrow(Option.fromNullishOr(way.subject_token));
  return {
    token_endpoint: placedText(Option.getOrThrow(Option.fromNullishOr(way.token_endpoint)), values),
    audience: placedText(Option.getOrThrow(Option.fromNullishOr(way.audience)), values),
    subject_token: { ...subjectToken, audience: placedText(subjectToken.audience, values) },
    ...(parameters === undefined ? {} : { parameters: placedEach(parameters, values) }),
    ...(impersonation === undefined
      ? {}
      : { impersonation: { ...impersonation, url: placedText(impersonation.url, values) } }),
    scope,
  };
}

interface PlacedAddress {
  readonly pointer: string;
  readonly address: string;
}

function unpinnedIssuesOf({ token_endpoint: tokenEndpoint, impersonation }: PlacedExchange): readonly Issue[] {
  const addresses: readonly PlacedAddress[] = [
    { pointer: '/credential/token_endpoint', address: tokenEndpoint },
    ...(impersonation === undefined ? [] : [{ pointer: '/credential/impersonation/url', address: impersonation.url }]),
  ];
  return addresses
    .filter(({ address }: PlacedAddress) => !isPinnableUrl(address))
    .map(({ pointer }: PlacedAddress) => ({ pointer, detail: pinnedUrlShape }));
}

export function exchangeOfProvider(
  provider: ProviderEntry,
  way: CredentialWay,
  placeholders: Readonly<Record<string, string>>,
): Result.Result<PlacedExchange, readonly Issue[]> {
  return Result.flatMap(valuesOf(provider, way, placeholders), (values) => {
    const exchange = exchangeWrittenIn(way, values);
    const issues = unpinnedIssuesOf(exchange);
    return issues.length === 0 ? Result.succeed(exchange) : Result.fail(issues);
  });
}
