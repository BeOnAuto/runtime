import { alternatives, type Issue } from '@on.auto/operations';
import { Option, Result } from 'effect';

import type { CredentialWay, WayKind } from '../entry/credential-ways.ts';
import { isRequired, type Placeholder } from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { placedText, valuesOf, type Values } from './placeholder-values.ts';

export interface GivenToProvider {
  readonly name?: string | undefined;
  readonly placeholders?: Readonly<Record<string, string>> | undefined;
  readonly kind?: string | undefined;
  readonly playbooks?: readonly string[] | undefined;
  readonly allowed?: readonly string[] | undefined;
  readonly record_content?: boolean | undefined;
}

export interface ProviderCredential {
  readonly kind: WayKind;
  readonly in?: NonNullable<CredentialWay['in']>;
  readonly name?: string;
  readonly scheme?: string;
  readonly issuer?: string;
  readonly scope?: string;
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
}

type Placed = Readonly<Record<string, string>>;

function wayOf(
  { name, credentials }: ProviderEntry,
  kind: string | undefined,
): Result.Result<CredentialWay, readonly Issue[]> {
  const [first] = credentials;
  const way = kind === undefined ? first : credentials.find((offered) => offered.kind === kind);
  return way === undefined
    ? Result.fail([
        {
          pointer: '/credential/kind',
          detail: `The provider ${name} takes no ${String(kind)} credential; it takes ${alternatives(credentials.map((offered) => offered.kind))}`,
        },
      ])
    : Result.succeed(way);
}

function credentialOf(
  { kind, in: placement, name, scheme, issuer, scope }: CredentialWay,
  values: Values,
): ProviderCredential {
  return {
    kind,
    ...(placement === undefined ? {} : { in: placement }),
    ...(name === undefined ? {} : { name }),
    ...(scheme === undefined ? {} : { scheme }),
    ...(issuer === undefined ? {} : { issuer: placedText(issuer, values) }),
    ...(scope === undefined ? {} : { scope }),
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
  const way = wayOf(provider, given.kind);
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
      })),
  });
}
