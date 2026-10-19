import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  additionOfProvider,
  readProviders,
  type Placeholder,
  type Provider,
  type ProviderAddition,
} from '@on.auto/providers';
import { describedToolServers, type ServerSettings, type ToolServers } from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { additionIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';
import { harnessAtTheVendor, servedAsTheVendor, startedAtTheVendor, type Vendor } from '../testing/vendor-fakes.ts';

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

function settingsOf(addition: ProviderAddition): ServerSettings {
  return Result.getOrThrow(readAddition(addition, checking, standIn));
}

function operationsIn(document = ''): number {
  const { paths } = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentSchema))(
    readFileSync(join(shipped.documents, document), 'utf8'),
  );
  return Object.values(paths).flatMap((operations) => Object.keys(operations)).length;
}

function documentsBesideTheEntries(): readonly string[] {
  return readdirSync(join(shipped.documents, 'documents'))
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
  it('are each offered whole by the reader of an HTTP API, every operation a tool within its bounds', async () => {
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

interface VendorOfTheWay extends Vendor {
  readonly resource: string;
  readonly asked?: string;
}

const vendors: Readonly<Record<string, VendorOfTheWay>> = {
  github: {
    metadata: {
      issuer: 'https://github.com/login/oauth',
      authorizationServer: 'https://github.com/login/oauth',
      protectedResource: 'https://api.githubcopilot.com/mcp',
      scopesSupported: ['offline_access'],
    },
    protectedResourceAt: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: 'https://github.com/.well-known/oauth-authorization-server/login/oauth',
    resource: 'https://api.githubcopilot.com/mcp',
    asked: 'read:org repo offline_access',
  },
  profound: {
    metadata: {
      issuer: 'https://auth.tryprofound.com',
      authorizationServer: 'https://auth.tryprofound.com/',
      protectedResource: 'https://mcp.tryprofound.com/mcp',
      scopesSupported: ['email', 'offline_access', 'openid', 'profile'],
      dynamicRegistration: true,
      clientMetadataDocuments: true,
    },
    protectedResourceAt: 'https://mcp.tryprofound.com/.well-known/oauth-protected-resource/mcp',
    authorizationServerAt: 'https://auth.tryprofound.com/.well-known/oauth-authorization-server',
    resource: 'https://mcp.tryprofound.com/mcp',
  },
  slack: {
    metadata: {
      issuer: 'https://mcp.slack.com',
      authorizationServer: 'https://mcp.slack.com',
      protectedResource: 'https://mcp.slack.com',
      takesBasicSecrets: false,
    },
    protectedResourceAt: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
    authorizationServerAt: 'https://mcp.slack.com/.well-known/oauth-authorization-server',
    resource: 'https://mcp.slack.com',
  },
};

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
      ? [{ name: entry.name, issuer, scope, clients, vendor: vendors[entry.name] }]
      : [],
  ),
);

const startedSourceOf = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal('connection_consent_started'),
    data: Schema.Struct({ client_source: Schema.String }),
  }),
);

async function startOf({ name, issuer, vendor }: WayOfConsent, registered: boolean) {
  const theVendor = required(vendor);
  const fake = await servedAsTheVendor(theVendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, theVendor, {
    providers: shipped,
    registeredIssuer: registered ? issuer : undefined,
  });
  const asked = await startedAtTheVendor(h, name);
  const facts = await h.facts();
  return {
    provider: name,
    at_its_authorization_endpoint: `${asked.origin}${asked.pathname}` === `${fake.origin}/authorize`,
    scope: asked.searchParams.get('scope'),
    resource: asked.searchParams.get('resource'),
    client_sources: facts.flatMap((fact) =>
      Option.toArray(Option.map(startedSourceOf(fact), ({ data }) => data.client_source)),
    ),
  };
}

function startExpectedOf({ name, scope, vendor }: WayOfConsent, source: string) {
  const { asked = scope, resource } = required(vendor);
  return { provider: name, at_its_authorization_endpoint: true, scope: asked, resource, client_sources: [source] };
}

describe('every way of consent of a shipped provider, against the fake authorization server at its vendor’s addresses', () => {
  it('starts at the issuer its server names, with its scope and what the metadata adds, by the client whoever runs Auto registered there', async () => {
    const starts = await Promise.all(waysOfConsent.map((consenting) => startOf(consenting, true)));

    expect(starts).toEqual(waysOfConsent.map((consenting) => startExpectedOf(consenting, 'registered')));
    expect(waysOfConsent.map(({ name }) => name)).toEqual(['github', 'profound', 'slack']);
  });

  it('starts without a registered client where its client sources take one the runtime registers itself', async () => {
    const registering = waysOfConsent.filter(({ clients }) => clients.includes('dynamic'));

    const starts = await Promise.all(registering.map((consenting) => startOf(consenting, false)));

    expect(starts).toEqual(registering.map((consenting) => startExpectedOf(consenting, 'dynamic')));
    expect(registering.map(({ name }) => name)).toEqual(['profound']);
  });
});
