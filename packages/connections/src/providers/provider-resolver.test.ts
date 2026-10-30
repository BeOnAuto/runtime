import { settingProblemText } from '@on.auto/config';
import { adverts, drive, fixtureProviders, providerListOf, providerOf } from '@on.auto/providers/testing';
import { readToolServerSettings, secretOrKeyExpected, type ServerSettings } from '@on.auto/tool-servers';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { wordsOfTheSettings } from '../entries/given-values.ts';
import { makeProviderResolver } from './provider-resolver.ts';

const token = 'tracker-token-5e8a1f0c';

const clientSecret = 'ledgers-client-secret-77b1';

const privateKey = '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';

const regionsKey = 'regions-key-30c9e1aa';

const developerToken = 'metrics-developer-token-0123';

const billingKey = 'billing-key-48c2d0e7';

const environment = {
  TRACKER_TOKEN: token,
  LEDGERS_CLIENT_SECRET: clientSecret,
  LEDGERS_PRIVATE_KEY: privateKey,
  REGIONS_KEY: regionsKey,
  METRICS_DEVELOPER_TOKEN: developerToken,
  BILLING_KEY: billingKey,
};

const site = { name: 'pages', title: 'Pages', description: 'Read the pages of a site.' };

const pages = providerOf({
  ...site,
  website: 'https://developer.pages.example.com',
  type: 'mcp',
  url: 'https://pages.example.com/mcp',
  headers: { 'X-Api-Version': '2' },
  credentials: [{ kind: 'secret', in: 'header', name: 'x-api-version' }],
});

const sessions = providerOf({
  ...site,
  name: 'sessions',
  website: 'https://developer.pages.example.com',
  type: 'mcp',
  url: 'https://sessions.example.com/mcp',
  credentials: [{ kind: 'secret', in: 'header', name: 'Mcp-Session-Id' }],
});

const billing = providerOf({
  ...site,
  name: 'billing',
  website: 'https://developer.billing.example.com',
  type: 'openapi',
  document: 'https://billing.example.com/openapi.json',
  base_url: 'https://api.billing.example.com/v2',
  credentials: [{ kind: 'secret', in: 'security', name: 'apiKeyAuth' }],
});

const resolver = makeProviderResolver(
  providerListOf(...fixtureProviders.providers, pages, sessions, billing, providerOf(drive), providerOf(adverts)),
);

function read(servers: unknown, variables: Readonly<Record<string, string>> = environment) {
  return readToolServerSettings(
    { ...variables, TOOL_SERVERS: JSON.stringify(servers) },
    { modelProviders: ['openai'], providers: resolver },
  );
}

function serverOf(entry: unknown): ServerSettings | undefined {
  return Effect.runSync(read({ named: entry })).servers[0];
}

function problemsOf(entry: unknown, variables?: Readonly<Record<string, string>>): readonly string[] {
  return Effect.runSync(Effect.flip(read({ named: entry }, variables))).problems.map((problem) =>
    settingProblemText(problem),
  );
}

function plain(values: ReadonlyMap<string, Redacted.Redacted> | undefined): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...(values ?? new Map())].map(([name, value]: readonly [string, Redacted.Redacted]) => [
      name,
      Redacted.value(value),
    ]),
  );
}

function headersOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  return plain(server?.type === 'stdio' ? undefined : server?.headers);
}

function queryOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  return plain(server?.type === 'openapi' ? server.query_params : undefined);
}

function securityOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  return plain(server?.type === 'openapi' ? server.security : undefined);
}

function secretsOf(server: ServerSettings | undefined): readonly string[] {
  return (server?.secrets ?? []).map((secret) => Redacted.value(secret));
}

const acmeTracker = { provider: 'tracker', placeholders: { site: 'acme' }, org: 'acme' };

const acmeLedgers = { provider: 'ledgers', placeholders: { tenant: 'acme' }, org: 'acme' };

const clientSecretGiven = { client_id: 'acme-books', client_secret: '${LEDGERS_CLIENT_SECRET}' };

describe('a provider of a secret, named in the settings', () => {
  it('is its server with the placeholders in their place and the reference after the scheme where its way says', () => {
    const server = serverOf({ ...acmeTracker, credential: '${TRACKER_TOKEN}', allowed: ['search'] });

    expect(server).toMatchObject({
      type: 'mcp',
      url: 'https://acme.tracker.example.com/mcp',
      allowed: ['search'],
      provider: 'tracker',
    });
    expect([headersOf(server), secretsOf(server)]).toEqual([{ Authorization: `Bearer ${token}` }, [token]]);
  });

  it('takes another way the provider offers by its kind, and the secret in a query parameter where the way says', () => {
    const regions = { provider: 'regions', placeholders: { region: 'eu', account: 'acme1' }, org: 'acme' };

    expect(headersOf(serverOf({ ...acmeTracker, credential: { kind: 'none' } }))).toEqual({});
    expect(queryOf(serverOf({ ...regions, credential: { value: '${REGIONS_KEY}' } }))).toEqual({
      account: 'acme1',
      api_key: regionsKey,
    });
  });

  it('sends a value whoever runs the runtime sets, as its entry refers to it, a secret of the server', () => {
    const server = serverOf({ provider: 'metrics', credential: '${TRACKER_TOKEN}', org: 'acme' });

    expect([headersOf(server), secretsOf(server)]).toEqual([
      { 'X-Developer-Token': developerToken, Authorization: `Bearer ${token}` },
      [developerToken, token],
    ]);
  });
});

describe('a provider of client credentials, named in the settings', () => {
  it('is its server with the client id given, sent where the provider says, and the secret referred to', () => {
    const server = serverOf({ ...acmeLedgers, credential: clientSecretGiven });

    expect(server).toMatchObject({
      type: 'openapi',
      document: { kind: 'url', url: 'https://ledgers.example.com/openapi.json' },
      base_url: 'https://api.ledgers.example.com/acme/v2',
      request_id: 'X-Request-Id',
      auth: {
        issuer: 'https://auth.ledgers.example.com/acme',
        client_id: 'acme-books',
        scope: 'journal.read journal.write',
        credential: { kind: 'client_secret' },
      },
      provider: 'ledgers',
    });
    expect([headersOf(server), secretsOf(server)]).toEqual([
      { 'X-Client': 'acme-books', 'X-Format': 'json' },
      [clientSecret],
    ]);
  });

  it('takes a private key with its algorithm in place of the secret', () => {
    const credential = { client_id: 'acme-books', private_key: '${LEDGERS_PRIVATE_KEY}', algorithm: 'RS256' };

    expect(serverOf({ ...acmeLedgers, credential })).toMatchObject({
      auth: { client_id: 'acme-books', credential: { kind: 'private_key', algorithm: 'RS256' } },
    });
  });
});

describe('a provider named in the settings, refused', () => {
  it('at a name, a placeholder or a way it does not have, at the key the operator wrote', () => {
    expect([
      problemsOf({ provider: 'crm', org: 'acme' }),
      problemsOf({ provider: 'tracker', placeholders: { team: 'core' }, org: 'acme' }),
      problemsOf({ ...acmeTracker, placeholders: { site: 'acme.evil' }, credential: { kind: 'client_credentials' } }),
    ]).toEqual([
      ['TOOL_SERVERS: /named/provider: There is no provider named crm here'],
      [
        'TOOL_SERVERS: /named/placeholders/team: The provider tracker has no placeholder team; it takes site',
        'TOOL_SERVERS: /named/placeholders/site: Expected site: The subdomain of your site, as in https://<site>.tracker.example.com',
      ],
      [
        'TOOL_SERVERS: /named/placeholders/site: Expected a value that matches ^[A-Za-z0-9-]{1,63}$, such as acme',
        'TOOL_SERVERS: /named/credential/kind: The provider tracker takes no client_credentials credential; it takes secret or none',
      ],
    ]);
  });

  it('at a credential its way does not take', () => {
    expect([
      problemsOf({ ...acmeTracker, credential: { kind: 'none', value: '${TRACKER_TOKEN}' } }),
      problemsOf({ ...acmeTracker }),
      problemsOf({ ...acmeTracker, credential: { value: '${TRACKER_TOKEN}', client_id: 'acme' } }),
      problemsOf({ ...acmeLedgers, credential: { client_secret: '${LEDGERS_CLIENT_SECRET}' } }),
      problemsOf({ ...acmeLedgers, credential: '${LEDGERS_CLIENT_SECRET}' }),
    ]).toEqual([
      ['TOOL_SERVERS: /named/credential: Expected no credential: the way none takes none'],
      [`TOOL_SERVERS: /named/credential: ${wordsOfTheSettings.secretAlone}`],
      [`TOOL_SERVERS: /named/credential: ${wordsOfTheSettings.secretAlone}`],
      [`TOOL_SERVERS: /named/credential/client_id: ${wordsOfTheSettings.clientIdLacking}`],
      [
        `TOOL_SERVERS: /named/credential: ${secretOrKeyExpected}`,
        `TOOL_SERVERS: /named/credential: ${wordsOfTheSettings.clientIdLacking}`,
      ],
    ]);
  });

  it('at a way that places its credential in a header the provider sends, in any case, or one the client sets itself', () => {
    expect([
      problemsOf({ provider: 'pages', credential: '${PAGES_TOKEN}', org: 'acme' }),
      problemsOf({ provider: 'sessions', credential: '${SESSIONS_TOKEN}', org: 'acme' }),
    ]).toEqual([
      ['TOOL_SERVERS: /named/provider: The entry sends this header already, so the credential cannot go in it'],
      ['TOOL_SERVERS: /named/provider: A header the MCP client sets itself, so the credential cannot go in it'],
    ]);
  });
});

const consentAnotherWay =
  "The provider adverts takes no authorization credential in the settings file, since a person gives that consent on Studio's page; it takes secret";

const consentAlone =
  "The provider drive takes authorization alone, a consent a person gives on Studio's page, which an entry of the settings file cannot give, so a person connects it there";

const acmeAdverts = { provider: 'adverts', placeholders: { tenant: 'acme' }, org: 'acme' };

type Refusal = readonly [string, Readonly<Record<string, unknown>>, string];

const consentRefusals: readonly Refusal[] = [
  ['/credential/kind', { ...acmeAdverts, credential: { kind: 'authorization' } }, consentAnotherWay],
  ['/credential', { provider: 'drive', credential: '${DRIVE_TOKEN}', org: 'acme' }, consentAlone],
  ['/credential', { provider: 'drive', org: 'acme' }, consentAlone],
  ['/credential/kind', { provider: 'drive', credential: { kind: 'authorization' }, org: 'acme' }, consentAlone],
];

describe('a provider whose way is consent, named in the settings', () => {
  it.each(consentRefusals)(
    'is refused at %s for the entry %j, in the words of the ways it takes',
    (pointer, entry, words) => {
      expect(problemsOf(entry)).toEqual([`TOOL_SERVERS: /named${pointer}: ${words}`]);
    },
  );

  it('is its server by the way kind names, or by the first the settings can give where it names none', () => {
    const named = serverOf({ ...acmeAdverts, credential: { kind: 'secret', value: '${BILLING_KEY}' } });
    const taken = serverOf({ ...acmeAdverts, credential: '${BILLING_KEY}' });
    const byTheKey = [{ 'X-Api-Key': billingKey }, [billingKey]];

    expect([named, taken].map((server) => [headersOf(server), secretsOf(server)])).toEqual([byTheKey, byTheKey]);
    expect(problemsOf(acmeAdverts)).toEqual([`TOOL_SERVERS: /named/credential: ${wordsOfTheSettings.secretAlone}`]);
  });
});

describe('a provider of a security scheme, named in the settings', () => {
  it('is its server with the reference under its scheme, which a problem of the reading is placed at the credential for', () => {
    const { BILLING_KEY: _key, ...withoutTheKey } = environment;

    expect(serverOf({ provider: 'billing', credential: '${BILLING_KEY}', org: 'acme' })).toMatchObject({
      type: 'openapi',
      base_url: 'https://api.billing.example.com/v2',
      provider: 'billing',
    });
    expect(securityOf(serverOf({ provider: 'billing', credential: '${BILLING_KEY}', org: 'acme' }))).toEqual({
      apiKeyAuth: billingKey,
    });
    expect(problemsOf({ provider: 'billing', credential: '${BILLING_KEY}', org: 'acme' }, withoutTheKey)).toEqual([
      'TOOL_SERVERS: /named/credential: Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}',
      'TOOL_SERVERS: /named/credential: Refers to the environment variable BILLING_KEY, which is not set',
    ]);
  });
});

describe('the problems the reading finds in what a provider named in the settings resolved', () => {
  it('are at the credential where they are its own, and at the provider where they are what it resolved', () => {
    const { TRACKER_TOKEN: _token, ...withoutTheToken } = environment;
    const { METRICS_DEVELOPER_TOKEN: _value, ...withoutTheValue } = environment;
    const { LEDGERS_PRIVATE_KEY: _privateKey, ...withoutTheKey } = environment;
    const keyed = { client_id: 'acme-books', private_key: '${LEDGERS_PRIVATE_KEY}', algorithm: 'RS256' };

    expect([
      problemsOf({ ...acmeTracker, credential: '${TRACKER_TOKEN}' }, withoutTheToken),
      problemsOf({ ...acmeLedgers, credential: keyed }, withoutTheKey),
      problemsOf({ provider: 'metrics', credential: '${TRACKER_TOKEN}', org: 'acme' }, withoutTheValue),
    ]).toEqual([
      ['TOOL_SERVERS: /named/credential: Refers to the environment variable TRACKER_TOKEN, which is not set'],
      [
        'TOOL_SERVERS: /named/credential/private_key: Refers to the environment variable LEDGERS_PRIVATE_KEY, which is not set',
      ],
      ['TOOL_SERVERS: /named/provider: Refers to the environment variable METRICS_DEVELOPER_TOKEN, which is not set'],
    ]);
  });
});
