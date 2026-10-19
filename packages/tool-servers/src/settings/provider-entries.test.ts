import { join } from 'node:path';

import { clientIdWrittenOut, settingProblemText } from '@on.auto/config';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings, type Environment, type ServerSettings } from '../index.ts';
import { fakeProviders, type FakeProvider } from '../testing/fake-providers.ts';

const token = 'tracker-token-5e8a1f0c';

const clientSecret = 'ledgers-client-secret-77b1';

const developerToken = 'ledgers-developer-token-0d4e';

const environment: Environment = {
  TRACKER_TOKEN: token,
  LEDGERS_CLIENT_SECRET: clientSecret,
  LEDGERS_DEVELOPER_TOKEN: developerToken,
};

const reference = (variable: string | undefined): string => `\${${variable ?? 'NONE'}}`;

const tracker: FakeProvider = ({ placeholders, credential }) => ({
  type: 'mcp',
  url: `https://${placeholders['site'] ?? 'www'}.tracker.example.com/mcp`,
  headers: { Authorization: `Bearer ${reference(credential.value)}` },
  request_id: 'X-Request-Id',
});

const ledgers: FakeProvider = ({ credential }) => ({
  type: 'openapi',
  document: 'documents/ledgers.openapi.json',
  headers: { 'X-Client': '{client_id}', 'X-Developer-Token': '${LEDGERS_DEVELOPER_TOKEN}' },
  auth: {
    issuer: 'https://auth.ledgers.example.com',
    client_id: credential.client_id ?? '',
    client_secret: reference(credential.client_secret),
  },
});

const refusing: FakeProvider = () => ({
  refused: [
    { pointer: '/placeholders/site', detail: 'The provider refusing has no placeholder site; it takes none' },
    { pointer: '/credential/value', detail: 'Expected value alone, the secret of a credential of the kind secret' },
  ],
});

const documents = join(import.meta.dirname, 'documents-of-the-providers');

function providers() {
  return fakeProviders(
    new Map([
      ['tracker', tracker],
      ['ledgers', ledgers],
      ['refusing', refusing],
    ]),
    documents,
  );
}

function readWith(servers: unknown, given = providers(), variables: Environment = environment) {
  return readToolServerSettings(
    { ...variables, TOOL_SERVERS: JSON.stringify(servers) },
    { modelProviders: ['openai'], providers: given.resolver },
  );
}

function serverOf(servers: unknown, given = providers()): ServerSettings | undefined {
  return Effect.runSync(readWith(servers, given)).servers[0];
}

function problemsOf(servers: unknown, variables: Environment = environment): readonly string[] {
  return Effect.runSync(Effect.flip(readWith(servers, providers(), variables))).problems.map((problem) =>
    settingProblemText(problem),
  );
}

function headersOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  const headers = server === undefined || server.type === 'stdio' ? new Map() : server.headers;
  return Object.fromEntries(
    [...headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

function secretsOf(server: ServerSettings | undefined): readonly string[] {
  return (server?.secrets ?? []).map((secret) => Redacted.value(secret));
}

const trackerEntry = {
  provider: 'tracker',
  placeholders: { site: 'acme' },
  credential: '${TRACKER_TOKEN}',
  org: 'acme',
  playbooks: ['sales'],
  allowed: ['search'],
  record_content: false,
};

const referenceAlone =
  'Expected a reference alone to the environment variable that holds the credential, such as ${TRACKER_TOKEN}, which the provider places where its way says';

describe('an entry that names a provider of a secret', () => {
  it('is the server the provider resolves to, with the org, playbooks, tools and content it gives, and its provider', () => {
    const given = providers();
    const server = serverOf({ issues: trackerEntry }, given);

    expect(server).toMatchObject({
      name: 'issues',
      type: 'mcp',
      url: 'https://acme.tracker.example.com/mcp',
      orgs: ['acme'],
      playbooks: ['sales'],
      allowed: ['search'],
      record_content: false,
      request_id: 'X-Request-Id',
      connection: null,
      provider: 'tracker',
    });
    expect([headersOf(server), secretsOf(server)]).toEqual([{ Authorization: `Bearer ${token}` }, [token]]);
    expect(given.named()).toEqual([
      { provider: 'tracker', placeholders: { site: 'acme' }, credential: { value: 'TRACKER_TOKEN' } },
    ]);
  });

  it('is beside an entry of its own, which is read as before, with no provider', () => {
    expect(
      Effect.runSync(readWith({ issues: trackerEntry, graph: { url: 'https://graph.example.com/mcp', org: 'acme' } }))
        .servers,
    ).toMatchObject([
      { name: 'issues', provider: 'tracker' },
      { name: 'graph', provider: null },
    ]);
  });
});

describe('an entry that names a provider of client credentials', () => {
  it('gives the provider the variables its references name, and is read with the values it places and from its folder', () => {
    const given = providers();
    const credential = {
      kind: 'client_credentials',
      client_id: 'acme-books',
      client_secret: '${LEDGERS_CLIENT_SECRET}',
    };
    const server = serverOf({ books: { provider: 'ledgers', credential, org: 'acme' } }, given);

    expect(given.named()).toEqual([
      {
        provider: 'ledgers',
        placeholders: {},
        credential: { kind: 'client_credentials', client_id: 'acme-books', client_secret: 'LEDGERS_CLIENT_SECRET' },
      },
    ]);
    expect(server).toMatchObject({
      type: 'openapi',
      provider: 'ledgers',
      document: { kind: 'file', path: join(documents, 'documents/ledgers.openapi.json') },
      auth: { issuer: 'https://auth.ledgers.example.com', client_id: 'acme-books' },
    });
    expect([headersOf(server), secretsOf(server)]).toEqual([
      { 'X-Client': 'acme-books', 'X-Developer-Token': developerToken },
      [developerToken, clientSecret],
    ]);
  });
});

describe('the fields an entry that names a provider may hold', () => {
  it('are none of the server, which the provider gives', () => {
    expect(
      problemsOf({
        issues: { provider: 'tracker', url: 'https://tracker.example.com/mcp', request_id: 'X-Id', org: 'acme' },
      }),
    ).toEqual([
      'TOOL_SERVERS: /issues/url: Expected no url: the provider gives the server',
      'TOOL_SERVERS: /issues/request_id: Expected no request_id: the provider gives the server',
    ]);
  });

  it('are those of an entry of its own without a provider, placeholders and a credential refused', () => {
    expect(
      problemsOf({
        graph: { url: 'https://graph.example.com/mcp', placeholders: {}, credential: '${TRACKER_TOKEN}', org: 'acme' },
      }),
    ).toEqual([
      'TOOL_SERVERS: /graph/placeholders: Expected no placeholders without provider',
      'TOOL_SERVERS: /graph/credential: Expected no credential without provider',
    ]);
  });
});

describe('the credential of an entry that names a provider', () => {
  it('holds a reference alone where a reference goes, and no $ where none does', () => {
    const books = {
      provider: 'ledgers',
      credential: {
        client_id: 'acme$books',
        private_key: 'Bearer ${LEDGERS_PRIVATE_KEY}',
        algorithm: 'RS256',
        client_secret: '${LEDGERS_CLIENT_SECRET:-none}',
      },
      org: 'acme',
    };

    expect(problemsOf({ issues: { ...trackerEntry, credential: 'tracker-token-5e8a1f0c' }, books })).toEqual([
      `TOOL_SERVERS: /issues/credential: ${referenceAlone}`,
      `TOOL_SERVERS: /books/credential/client_secret: ${referenceAlone}`,
      `TOOL_SERVERS: /books/credential/private_key: ${referenceAlone}`,
      'TOOL_SERVERS: /books/credential/client_id: Expected no $: of a credential, only value, client_secret and private_key hold a reference',
    ]);
  });

  it('holds a client id written out, which never has the shape of a credential, before the provider is asked', () => {
    const credential = { client_id: 'sk-live-0123456789abcdefghij', client_secret: '${LEDGERS_CLIENT_SECRET}' };
    const given = providers();

    expect(
      Effect.runSync(
        Effect.flip(readWith({ books: { provider: 'ledgers', credential, org: 'acme' } }, given)),
      ).problems.map((problem) => settingProblemText(problem)),
    ).toEqual([`TOOL_SERVERS: /books/credential/client_id: ${clientIdWrittenOut}`]);
    expect(given.named()).toEqual([]);
  });
});

describe('the refusals of the provider an entry names', () => {
  it('are placed under the entry, at the key the operator wrote, a credential written as a reference at its own', () => {
    expect(
      problemsOf({
        issues: { provider: 'refusing', placeholders: { site: 'acme' }, credential: '${TRACKER_TOKEN}', org: 'acme' },
        books: { provider: 'crm', org: 'acme' },
      }),
    ).toEqual([
      'TOOL_SERVERS: /issues/placeholders/site: The provider refusing has no placeholder site; it takes none',
      'TOOL_SERVERS: /issues/credential: Expected value alone, the secret of a credential of the kind secret',
      'TOOL_SERVERS: /books/provider: There is no fake provider named crm',
    ]);
  });

  it('are a provider no reading knows, where none is given', () => {
    const read = readToolServerSettings(
      { TOOL_SERVERS: JSON.stringify({ issues: { provider: 'tracker', org: 'acme' } }) },
      { modelProviders: [] },
    );

    expect(Effect.runSync(Effect.flip(read)).problems.map((problem) => settingProblemText(problem))).toEqual([
      'TOOL_SERVERS: /issues/provider: This reading knows no provider, so none named tracker',
    ]);
  });
});

describe('the problems the reading finds in what a provider resolved', () => {
  it('are placed at the key that wrote it, the provider or the credential, and the keys of the entry at their own', () => {
    const books = { provider: 'ledgers', credential: { client_id: 'acme', client_secret: '${LEDGERS_CLIENT_SECRET}' } };

    expect([
      problemsOf({ books: { ...books, org: 'acme' } }, { LEDGERS_CLIENT_SECRET: clientSecret }),
      problemsOf({ issues: trackerEntry }, {}),
      problemsOf({ issues: { ...trackerEntry, org: 'Acme Corp' } }),
      problemsOf({ books }),
    ]).toEqual([
      ['TOOL_SERVERS: /books/provider: Refers to the environment variable LEDGERS_DEVELOPER_TOKEN, which is not set'],
      ['TOOL_SERVERS: /issues/credential: Refers to the environment variable TRACKER_TOKEN, which is not set'],
      ['TOOL_SERVERS: /issues/org: Expected an org id, a list of them, or *'],
      ['TOOL_SERVERS: /books: Expected the org this server serves'],
    ]);
  });
});
