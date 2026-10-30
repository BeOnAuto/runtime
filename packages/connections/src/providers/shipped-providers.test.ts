import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import {
  additionOfProvider,
  holdsAClientId,
  readProviders,
  type Placeholder,
  type Provider,
  type ProviderAddition,
  providersShippedRoots,
} from '@on.auto/providers';
import {
  describedToolServers,
  isConnectionServerSettings,
  type AuthSettings,
  type ServerSettings,
  type ToolServers,
} from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionIssuesOf, readAddition, type AdditionInput } from '../entries/entry-checks.ts';
import { credentialFieldIssuesOf, placesNoValue } from '../registry/credential.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const filesBesideTheEntries = await providersOnDisk.list({
  package: '@on.auto/providers',
  path: 'src/entries/documents',
});

const checking = {
  org: 'acme',
  modelProviders: ['anthropic', 'openai'],
  providing: { documents: shipped.documents, values: new Map(), documentServer: undefined },
};

const standIn = { value: Redacted.make('a value the person gives'), algorithm: undefined };

const clientId = 'a client id of the connection';

const DocumentSchema = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});

type Given = Readonly<Record<string, string>>;

function valuesOf({ example = '', choices }: Placeholder): readonly string[] {
  return choices === undefined ? [example] : choices.map(({ value }) => value);
}

function givenOf(given: readonly Given[], [name, placeholder]: readonly [string, Placeholder]): readonly Given[] {
  return given.flatMap((each) =>
    valuesOf(placeholder).map((value) => Object.fromEntries([...Object.entries(each), [name, value]])),
  );
}

function examplesOf({ entry }: Provider): readonly Given[] {
  return Object.entries(entry.placeholders ?? {}).reduce<readonly Given[]>(
    (given, placeholder: readonly [string, Placeholder]) => givenOf(given, placeholder),
    [{}],
  );
}

function additionsOf(provider: Provider): readonly ProviderAddition[] {
  return provider.entry.credentials.flatMap(({ kind }) =>
    examplesOf(provider).map((placeholders) =>
      Result.getOrThrow(additionOfProvider(provider.entry, { placeholders, kind })),
    ),
  );
}

const additions = shipped.providers.flatMap((provider) => additionsOf(provider));

function authOfTheConsent({ credential }: ProviderAddition): AuthSettings {
  return {
    issuer: credential.issuer ?? '',
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

function settingsOf(addition: ProviderAddition): ServerSettings {
  const { kind } = addition.credential;
  const read = readAddition(withTheClientId(addition), checking, placesNoValue(kind) ? undefined : standIn);
  const settings = Option.getOrThrow(Option.liftPredicate(Result.getOrThrow(read), isConnectionServerSettings));
  return kind === 'authorization' ? { ...settings, auth: authOfTheConsent(addition) } : settings;
}

function operationsIn(document = ''): number {
  const { paths } = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentSchema))(
    shipped.documents.get(document)?.text ?? '',
  );
  return Object.values(paths).flatMap((operations) => Object.keys(operations)).length;
}

function documentsBesideTheEntries(): readonly string[] {
  return filesBesideTheEntries
    .filter((file) => file.endsWith('.openapi.json'))
    .map((file) => `documents/${file}`)
    .toSorted();
}

function offeredOperationsOf({ servers }: ToolServers): readonly (readonly [string, number])[] {
  return servers.map((server) => [server.name, server.type === 'openapi' ? server.api.operations.length : 0]);
}

function headersOf(settings: ServerSettings): Readonly<Record<string, string>> {
  return settings.type === 'stdio'
    ? {}
    : Object.fromEntries(
        [...settings.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [
          name,
          Redacted.value(value),
        ]),
      );
}

function isRegional({ placeholders }: ProviderAddition): boolean {
  return Object.hasOwn(placeholders, 'region');
}

function placesTheClientId({ entry }: ProviderAddition): boolean {
  return Object.values(entry.headers ?? {}).includes('{client_id}');
}

function hostsOf({ name, entry, credential }: ProviderAddition) {
  return [name, entry.url ?? entry.base_url, credential.authorization_endpoint, credential.token_endpoint];
}

function namedProvider(name: string): Provider {
  return Option.getOrThrow(Option.fromNullishOr(shipped.providers.find(({ entry }) => entry.name === name)));
}

const regionalHosts = [
  [
    'amazon-ads',
    'https://advertising-api.amazon.com',
    'https://www.amazon.com/ap/oa',
    'https://api.amazon.com/auth/o2/token',
  ],
  [
    'amazon-ads',
    'https://advertising-api-eu.amazon.com',
    'https://eu.account.amazon.com/ap/oa',
    'https://api.amazon.co.uk/auth/o2/token',
  ],
  [
    'amazon-ads',
    'https://advertising-api-fe.amazon.com',
    'https://apac.account.amazon.com/ap/oa',
    'https://api.amazon.co.jp/auth/o2/token',
  ],
  ['amazon-ads-mcp', 'https://advertising-ai.amazon.com/mcp', undefined, undefined],
  ['amazon-ads-mcp', 'https://advertising-ai-eu.amazon.com/mcp', undefined, undefined],
  ['amazon-ads-mcp', 'https://advertising-ai-fe.amazon.com/mcp', undefined, undefined],
];

const advertiserAccount = 'amzn1.ads-account.g.26eqvvnjl03bvzcsjv6yp81x';

const placedClientIds = [
  ['adobe-analytics', { 'x-api-key': clientId }],
  ['adobe-analytics', { 'x-api-key': clientId }],
  ...Array.from({ length: 3 }, () => [
    'amazon-ads',
    { 'Amazon-Ads-ClientId': clientId, 'Amazon-Ads-AccountId': advertiserAccount },
  ]),
  ...Array.from({ length: 3 }, () => ['amazon-ads-mcp', { 'Amazon-Ads-ClientId': clientId }]),
];

describe('every way of every shipped provider, resolved with the examples of its placeholders and each choice', () => {
  it('passes the checks of the credential and of an addition that a connection added by hand passes', () => {
    expect(additions.map(({ name, credential }) => [name, credentialFieldIssuesOf(credential)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
    expect(additions.map((addition) => [addition.name, additionIssuesOf(addition, checking)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
  });

  it('places the hosts a region sets in the address and the endpoints of its way together', () => {
    expect(additions.filter((addition) => isRegional(addition)).map((addition) => hostsOf(addition))).toEqual(
      regionalHosts,
    );
  });

  it('sends the client id of the connection in the headers that hold {client_id}, a header named as a key among them', () => {
    const placing = additions.filter((addition) => placesTheClientId(addition));

    expect(placing.map((addition) => [addition.name, headersOf(settingsOf(addition))])).toEqual(placedClientIds);
  });

  it('sends no header of an optional placeholder the connection is added without, as an Amazon Ads connection without an account', () => {
    const withoutAnAccount = additionOfProvider(namedProvider('amazon-ads').entry, {
      placeholders: { region: 'na' },
      kind: 'authorization',
    });

    expect(headersOf(settingsOf(Result.getOrThrow(withoutAnAccount)))).toEqual({ 'Amazon-Ads-ClientId': clientId });
  });
});

describe('the documents beside the shipped entries', () => {
  it('are each offered whole by the reader of an HTTP API, every operation a tool within its bounds, a way of consent with the auth its serving gives', async () => {
    const leftOut: string[] = [];
    const described = additions.filter(({ type }) => type === 'openapi');
    const servers = await Effect.runPromise(
      describedToolServers(
        { servers: described.map((addition) => settingsOf(addition)), referencedVariables: [] },
        {
          reportLeftOut: (server, operation) => {
            leftOut.push(`${server}: ${operation.because}`);
          },
        },
      ),
    );

    expect(leftOut).toEqual([]);
    expect(offeredOperationsOf(servers)).toEqual(
      described.map(({ name, entry }) => [name, operationsIn(entry.document)]),
    );
    expect([...new Set(described.map(({ entry }) => String(entry.document)))].toSorted()).toEqual(
      documentsBesideTheEntries(),
    );
    expect(described.length).toBeGreaterThan(0);
  });
});
