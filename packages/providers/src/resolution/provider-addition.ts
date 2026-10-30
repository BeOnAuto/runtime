import { alternatives, type Issue } from '@on.auto/operations';
import type { WayApp } from '@on.auto/tool-servers';
import { Option, Result } from 'effect';

import type { CredentialWay, WayKind } from '../entry/credential-ways.ts';
import { isRequired, type Placeholder } from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { wayAddresses, type WayAddress, type WayAddresses } from '../entry/templates.ts';
import { placedText, valuesOf, type Values } from './placeholder-values.ts';

export interface GivenToProvider {
  readonly name?: string | undefined;
  readonly placeholders?: Readonly<Record<string, string>> | undefined;
  readonly kind?: string | undefined;
  readonly appFor?: ((way: CredentialWay) => WayApp | undefined) | undefined;
  readonly canBeGiven?: ((way: CredentialWay) => boolean) | undefined;
  readonly playbooks?: readonly string[] | undefined;
  readonly allowed?: readonly string[] | undefined;
  readonly record_content?: boolean | undefined;
}

export interface ProviderCredential extends WayAddresses {
  readonly kind: WayKind;
  readonly in?: NonNullable<CredentialWay['in']>;
  readonly name?: string;
  readonly scheme?: string;
  readonly scope?: string;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly pkce?: NonNullable<CredentialWay['pkce']>;
  readonly clients?: NonNullable<CredentialWay['clients']>;
  readonly client_source?: WayApp;
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

export interface ProviderAddition {
  readonly name: string;
  readonly type: ProviderEntry['type'];
  readonly entry: ProviderConnectionEntry;
  readonly credential: ProviderCredential;
  readonly provider: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly says?: Readonly<Record<string, string>>;
}

type Placed = Readonly<Record<string, string>>;

function everyWay(): boolean {
  return true;
}

function kindsOf(credentials: readonly CredentialWay[]): string {
  return alternatives([...new Set(credentials.map((offered) => offered.kind))]);
}

function kindRefusalOf(name: string, kind: string, credentials: readonly CredentialWay[]): readonly Issue[] {
  return [
    {
      pointer: '/credential/kind',
      detail: `The provider ${name} takes no ${kind} credential; it takes ${kindsOf(credentials)}`,
    },
  ];
}

function wayOf(
  { name, credentials }: ProviderEntry,
  { kind, canBeGiven = everyWay }: GivenToProvider,
): Result.Result<CredentialWay, readonly Issue[]> {
  const named = credentials.filter((offered) => kind === undefined || offered.kind === kind);
  const [first] = named;
  const way = named.find((offered) => canBeGiven(offered)) ?? first;
  return way === undefined ? Result.fail(kindRefusalOf(name, String(kind), credentials)) : Result.succeed(way);
}

function placedAddressesOf(way: CredentialWay, values: Values): Partial<Record<WayAddress, string>> {
  return Object.fromEntries(
    wayAddresses.flatMap((field) => {
      const written = way[field];
      return written === undefined ? [] : [[field, placedText(written, values)]];
    }),
  );
}

const underTheOrgsApp: Pick<ProviderCredential, 'client_source'> = { client_source: 'own' };

function clientSourceOf({ kind, own_app: ownApp }: CredentialWay, app: WayApp | undefined) {
  return kind === 'authorization' && (app !== undefined || ownApp !== undefined) ? underTheOrgsApp : {};
}

function credentialOf(way: CredentialWay, values: Values, app: WayApp | undefined): ProviderCredential {
  const { kind, in: placement, name, scheme, scope, parameters, pkce, clients } = way;
  return {
    kind,
    ...clientSourceOf(way, app),
    ...(placement === undefined ? {} : { in: placement }),
    ...(name === undefined ? {} : { name }),
    ...(scheme === undefined ? {} : { scheme }),
    ...placedAddressesOf(way, values),
    ...(scope === undefined ? {} : { scope }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(pkce === undefined ? {} : { pkce }),
    ...(clients === undefined ? {} : { clients }),
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

function serverOf(entry: ProviderEntry, values: Values): ProviderConnectionEntry {
  const { url, document, base_url: baseUrl, headers, query_params: query, request_id: requestId } = entry;
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

export function additionOfProvider(
  provider: ProviderEntry,
  given: GivenToProvider,
): Result.Result<ProviderAddition, readonly Issue[]> {
  const placeholders = given.placeholders ?? {};
  const way = wayOf(provider, given);
  return Result.match(valuesOf(provider, placeholders), {
    onFailure: (placing) =>
      Result.fail([...placing, ...Result.getFailure(way).pipe(Option.getOrElse((): readonly Issue[] => []))]),
    onSuccess: (values) =>
      Result.map(way, (chosen) => ({
        name: given.name ?? provider.name,
        type: provider.type,
        entry: { ...serverOf(provider, values), ...perConnectionOf(given) },
        credential: credentialOf(chosen, values, given.appFor?.(chosen)),
        provider: provider.name,
        placeholders,
        ...(chosen.says === undefined ? {} : { says: chosen.says }),
      })),
  });
}
