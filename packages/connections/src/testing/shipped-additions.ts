import { createHash } from 'node:crypto';

import {
  additionOfProvider,
  holdsAClientId,
  type CredentialWay,
  readProviders,
  type Placeholder,
  type Provider,
  type ProviderAddition,
  providersShippedRoots,
} from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import {
  describedToolServers,
  isConnectionServerSettings,
  type AuthSettings,
  type ConnectionServerSettings,
} from '@on.auto/tool-servers';
import { Effect, Function, Option, Redacted, Result } from 'effect';

import { apiOf } from '../entries/described-entries.ts';
import { readAddition, type AdditionInput, type EntryChecking } from '../entries/entry-checks.ts';
import { providingOf } from '../providers/provider-providing.ts';
import { placesNoValue } from '../registry/credential.ts';

type Given = Readonly<Record<string, string>>;

type Digests = Readonly<Record<string, string>>;

export const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

export const checking = {
  org: 'acme',
  modelProviders: ['anthropic', 'openai'],
  providing: { documents: shipped.documents, values: new Map(), documentServer: undefined },
};

const standIn = { value: Redacted.make('a value the person gives'), algorithm: undefined };

export const clientId = 'a client id of the connection';

export const shippedToolsFile = new URL('../../shipped-tools.json', import.meta.url);

function valuesOf({ example = '', choices }: Placeholder): readonly string[] {
  return choices === undefined ? [example] : choices.map(({ value }) => value);
}

function givenOf(given: readonly Given[], [name, placeholder]: readonly [string, Placeholder]): readonly Given[] {
  return given.flatMap((each) =>
    valuesOf(placeholder).map((value) => Object.fromEntries([...Object.entries(each), [name, value]])),
  );
}

function examplesOf({ entry }: Provider, way: CredentialWay): readonly Given[] {
  return Object.entries({ ...entry.placeholders, ...way.placeholders }).reduce<readonly Given[]>(
    (given, placeholder: readonly [string, Placeholder]) => givenOf(given, placeholder),
    [{}],
  );
}

function additionsOf(provider: Provider): readonly ProviderAddition[] {
  return provider.entry.credentials.flatMap((way) =>
    examplesOf(provider, way).map((placeholders) =>
      Result.getOrThrow(
        additionOfProvider(provider.entry, { placeholders, kind: way.kind, canBeGiven: (offered) => offered === way }),
      ),
    ),
  );
}

export const additions = shipped.providers.flatMap((provider) => additionsOf(provider));

function authOfTheConsent({ credential }: ProviderAddition): AuthSettings {
  return {
    issuer: Option.getOrThrow(Option.fromNullishOr(credential.issuer)),
    client_id: clientId,
    scope: credential.scope ?? null,
    credential: { kind: 'client_secret', client_secret: standIn.value },
  };
}

function withTheClientId(addition: ProviderAddition): AdditionInput {
  const { credential } = addition;
  return holdsAClientId(credential.kind)
    ? { ...addition, credential: { ...credential, client_id: clientId } }
    : addition;
}

function checkingOf({ provider, credential, permissions }: ProviderAddition): EntryChecking {
  const services = { providers: shipped, providerValues: new Map<string, Redacted.Redacted>() };
  const acting = { ...credential, permissions };
  return { ...checking, providing: providingOf({ provider, credential: acting }, services) };
}

export function settingsOf(addition: ProviderAddition): ConnectionServerSettings {
  const { kind } = addition.credential;
  const read = readAddition(
    withTheClientId(addition),
    checkingOf(addition),
    placesNoValue(addition.credential) ? undefined : standIn,
  );
  const settings = Option.getOrThrow(Option.liftPredicate(Result.getOrThrow(read), isConnectionServerSettings));
  return kind === 'authorization' ? { ...settings, auth: authOfTheConsent(addition) } : settings;
}

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => canonical(item));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .toSorted(([one]: readonly [string, unknown], [other]: readonly [string, unknown]) => (one < other ? -1 : 1))
          .map(([key, item]: readonly [string, unknown]) => [key, canonical(item)]),
      )
    : value;
}

function keyOf({ name, credential }: ProviderAddition): string {
  return `${name}, ${credential.kind}`;
}

async function toolsOf(addition: ProviderAddition): Promise<Digests> {
  const servers = await Effect.runPromise(
    describedToolServers(
      { servers: [settingsOf(addition)], referencedVariables: [] },
      { reportLeftOut: Function.constVoid },
    ),
  );
  return Object.fromEntries(
    apiOf(servers).operations.map(({ tool: { name, ...served }, method, path, inputs }): readonly [string, string] => [
      name,
      digestOf({ ...served, method, path, inputs }),
    ]),
  );
}

function firstOfEach(described: readonly ProviderAddition[]): readonly ProviderAddition[] {
  const first = new Map<string, ProviderAddition>();
  for (const addition of described) {
    if (!first.has(keyOf(addition))) {
      first.set(keyOf(addition), addition);
    }
  }
  return [...first.values()];
}

export async function shippedToolsText(): Promise<string> {
  const described = firstOfEach(additions.filter(({ type }) => type === 'openapi'));
  const derived = await Promise.all(
    described.map(async (addition): Promise<readonly [string, Digests]> => [keyOf(addition), await toolsOf(addition)]),
  );
  const sorted = derived.toSorted(([one], [other]) => (one < other ? -1 : 1));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

export const shippedCredentialsFile = new URL('../../shipped-credentials.json', import.meta.url);

function wayKeyOf({ name, credential, permissions, placeholders }: ProviderAddition): string {
  return [name, credential.kind, permissions, new URLSearchParams(placeholders).toString()].filter(Boolean).join(', ');
}

function requestsOf(addition: ProviderAddition): string {
  return digestOf(canonical({ credential: addition.credential, auth: settingsOf(addition).auth }));
}

export function shippedCredentialsText(): string {
  const digests = additions.map((addition): readonly [string, string] => [wayKeyOf(addition), requestsOf(addition)]);
  const sorted = digests.toSorted(([one], [other]) => (one < other ? -1 : 1));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}
