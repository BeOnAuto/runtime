import { alternatives, type Issue } from '@on.auto/operations';
import { Option, Result } from 'effect';

import { asksTheSameScopes, type CredentialWay, type WayKind } from '../entry/credential-ways.ts';
import { isRequired, type Placeholder } from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { wayAddresses, type WayAddress, type WayAddresses } from '../entry/templates.ts';
import { placedText, valuesOf, type Values } from './placeholder-values.ts';

export interface GivenToProvider {
  readonly name?: string | undefined;
  readonly placeholders?: Readonly<Record<string, string>> | undefined;
  readonly kind?: string | undefined;
  readonly scope?: string | undefined;
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
  readonly clients?: NonNullable<CredentialWay['clients']>;
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

function scopesAskedBy(ways: readonly CredentialWay[]): string {
  return alternatives([...new Set(ways.map((offered) => `one that asks ${offered.scope ?? 'no scope'}`))]);
}

function kindRefusalOf(name: string, kind: string, credentials: readonly CredentialWay[]): readonly Issue[] {
  return [
    {
      pointer: '/credential/kind',
      detail: `The provider ${name} takes no ${kind} credential; it takes ${kindsOf(credentials)}`,
    },
  ];
}

function scopeRefusalOf(
  name: string,
  { kind, scope }: GivenToProvider,
  ways: readonly CredentialWay[],
): readonly Issue[] {
  const credential = kind === undefined ? 'credential' : `${kind} credential`;
  return [
    {
      pointer: '/credential/scope',
      detail: `The provider ${name} takes no ${credential} that asks ${String(scope)}; it takes ${scopesAskedBy(ways)}`,
    },
  ];
}

function wayOf(
  { name, credentials }: ProviderEntry,
  given: GivenToProvider,
): Result.Result<CredentialWay, readonly Issue[]> {
  const { kind, scope, canBeGiven = everyWay } = given;
  const ofTheKind = kind === undefined ? credentials : credentials.filter((offered) => offered.kind === kind);
  const named =
    scope === undefined ? ofTheKind : ofTheKind.filter((offered) => asksTheSameScopes(offered.scope, scope));
  const [first] = named;
  const way = named.find((offered) => canBeGiven(offered)) ?? first;
  if (way !== undefined) {
    return Result.succeed(way);
  }
  return Result.fail(
    kind !== undefined && ofTheKind.length === 0
      ? kindRefusalOf(name, kind, credentials)
      : scopeRefusalOf(name, given, ofTheKind),
  );
}

function placedAddressesOf(way: CredentialWay, values: Values): Partial<Record<WayAddress, string>> {
  return Object.fromEntries(
    wayAddresses.flatMap((field) => {
      const written = way[field];
      return written === undefined ? [] : [[field, placedText(written, values)]];
    }),
  );
}

function credentialOf(way: CredentialWay, values: Values): ProviderCredential {
  const { kind, in: placement, name, scheme, scope, parameters, clients } = way;
  return {
    kind,
    ...(placement === undefined ? {} : { in: placement }),
    ...(name === undefined ? {} : { name }),
    ...(scheme === undefined ? {} : { scheme }),
    ...placedAddressesOf(way, values),
    ...(scope === undefined ? {} : { scope }),
    ...(parameters === undefined ? {} : { parameters }),
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
        credential: credentialOf(chosen, values),
        provider: provider.name,
        placeholders,
        ...(chosen.says === undefined ? {} : { says: chosen.says }),
      })),
  });
}
