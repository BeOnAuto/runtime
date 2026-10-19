import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  additionOfProvider,
  readProviders,
  type Placeholder,
  type Provider,
  type ProviderAddition,
} from '@on.auto/providers';
import {
  describedToolServers,
  isConnectionServerSettings,
  type AuthSettings,
  type ServerSettings,
  type ToolServers,
} from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { additionIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { credentialFieldIssuesOf, placesNoValue } from '../registry/credential.ts';
import { vendorsOfTheShippedWays, type VendorOfTheWay } from '../testing/shipped-vendors.ts';
import { consentedAtTheVendor, harnessAtTheVendor, servedAsTheVendor } from '../testing/vendor-fakes.ts';

const shipped = Result.getOrThrow(readProviders());

const checking = {
  org: 'acme',
  modelProviders: ['anthropic', 'openai'],
  providing: { documents: shipped.documents, values: new Map(), documentServer: undefined },
};

const standIn = { value: Redacted.make('a value the person gives'), algorithm: undefined };

const DocumentSchema = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});

function examplesOf({ entry }: Provider): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(
      ([name, { example, choices = [] }]: readonly [string, Placeholder]) => [name, example ?? choices[0]?.value ?? ''],
    ),
  );
}

function additionsOf(provider: Provider): readonly ProviderAddition[] {
  return provider.entry.credentials.map(({ kind }) =>
    Result.getOrThrow(additionOfProvider(provider.entry, { placeholders: examplesOf(provider), kind })),
  );
}

const additions = shipped.providers.flatMap((provider) => additionsOf(provider));

function authOfTheConsent({ credential }: ProviderAddition): AuthSettings {
  return {
    issuer: credential.issuer ?? '',
    client_id: 'a client whoever runs Auto registered',
    scope: credential.scope ?? null,
    credential: { kind: 'client_secret', client_secret: standIn.value },
  };
}

function settingsOf(addition: ProviderAddition): ServerSettings {
  const { kind } = addition.credential;
  const read = Result.getOrThrow(readAddition(addition, checking, placesNoValue(kind) ? undefined : standIn));
  const settings = Option.getOrThrow(Option.liftPredicate(read, isConnectionServerSettings));
  return kind === 'authorization' ? { ...settings, auth: authOfTheConsent(addition) } : settings;
}

function operationsIn(document = ''): number {
  const { paths } = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentSchema))(
    readFileSync(join(shipped.documents, document), 'utf8'),
  );
  return Object.values(paths).flatMap((operations) => Object.keys(operations)).length;
}

function documentsBesideTheEntries(): readonly string[] {
  return readdirSync(join(shipped.documents, 'documents'))
    .filter((file) => file.endsWith('.openapi.json'))
    .map((file) => `documents/${file}`)
    .toSorted();
}

function offeredOperationsOf({ servers }: ToolServers): readonly (readonly [string, number])[] {
  return servers.map((server) => [server.name, server.type === 'openapi' ? server.api.operations.length : 0]);
}

describe('every way of every shipped provider, resolved with the examples of its placeholders', () => {
  it('passes the checks of the credential and of an addition that a connection added by hand passes', () => {
    expect(additions.map(({ name, credential }) => [name, credentialFieldIssuesOf(credential)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
    expect(additions.map((addition) => [addition.name, additionIssuesOf(addition, checking)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
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

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

interface WayOfConsent {
  readonly name: string;
  readonly issuer: string;
  readonly scope: string | undefined;
  readonly clients: readonly string[];
  readonly vendor: VendorOfTheWay | undefined;
}

const waysOfConsent: readonly WayOfConsent[] = shipped.providers.flatMap(({ entry }) =>
  entry.credentials.flatMap(({ kind, issuer, scope, clients = ['registered'] }) =>
    kind === 'authorization' && issuer !== undefined
      ? [{ name: entry.name, issuer, scope, clients, vendor: vendorsOfTheShippedWays[entry.name] }]
      : [],
  ),
);

const startedSourceOf = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal('connection_consent_started'),
    data: Schema.Struct({ client_source: Schema.String }),
  }),
);

const connectedOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      status: Schema.String,
      credential: Schema.Struct({ scope: Schema.optionalKey(Schema.String), client_source: Schema.String }),
    }),
  }),
);

function parametersAsked(
  asked: Readonly<URL>,
  { parameters = {} }: VendorOfTheWay,
): Readonly<Record<string, string | null>> {
  return Object.fromEntries(Object.keys(parameters).map((name) => [name, asked.searchParams.get(name)]));
}

async function consentOf({ name, issuer, vendor }: WayOfConsent, registered: boolean) {
  const theVendor = required(vendor);
  const fake = await servedAsTheVendor(theVendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, theVendor, {
    providers: shipped,
    registeredIssuer: registered ? issuer : undefined,
  });
  const { asked, finished } = await consentedAtTheVendor(h, name);
  const facts = await h.facts();
  const { status, credential } = connectedOf(finished).output;
  return {
    provider: name,
    at_its_authorization_endpoint: `${asked.origin}${asked.pathname}` === `${fake.origin}/authorize`,
    scope: asked.searchParams.get('scope'),
    resource: asked.searchParams.get('resource'),
    code_challenge_method: asked.searchParams.get('code_challenge_method'),
    parameters: parametersAsked(asked, theVendor),
    client_sources: facts.flatMap((fact) =>
      Option.toArray(Option.map(startedSourceOf(fact), ({ data }) => data.client_source)),
    ),
    connected: { status, scope: credential.scope, client_source: credential.client_source },
  };
}

function consentExpectedOf({ name, scope, vendor }: WayOfConsent, source: string) {
  const { asked = scope, resource, parameters = {} } = required(vendor);
  return {
    provider: name,
    at_its_authorization_endpoint: true,
    scope: asked,
    resource,
    code_challenge_method: 'S256',
    parameters,
    client_sources: [source],
    connected: { status: 'connected', scope: asked, client_source: source },
  };
}

describe('every way of consent of a shipped provider, against the fake authorization server at its vendor’s addresses', () => {
  it('starts at the issuer its server names, with its scope, what the metadata adds and the parameters it sets, by the client whoever runs Auto registered there, and finishes connected with that scope', async () => {
    const consents = await Promise.all(waysOfConsent.map((consenting) => consentOf(consenting, true)));

    expect(consents).toEqual(waysOfConsent.map((consenting) => consentExpectedOf(consenting, 'registered')));
    expect(waysOfConsent.map(({ name }) => name)).toEqual([
      'campaign-manager-360',
      'display-video-360',
      'display-video-360-reports',
      'github',
      'gmail',
      'google-ads',
      'google-analytics',
      'google-analytics-admin',
      'google-docs',
      'google-drive',
      'google-search-console',
      'google-sheets',
      'google-slides',
      'profound',
      'search-ads-360',
      'slack',
    ]);
  });

  it('starts and finishes without a registered client where its client sources take one the runtime registers itself', async () => {
    const registering = waysOfConsent.filter(({ clients }) => clients.includes('dynamic'));

    const consents = await Promise.all(registering.map((consenting) => consentOf(consenting, false)));

    expect(consents).toEqual(registering.map((consenting) => consentExpectedOf(consenting, 'dynamic')));
    expect(registering.map(({ name }) => name)).toEqual(['profound']);
  });
});
