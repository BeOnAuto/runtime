import type { Provider, ProviderList } from '@on.auto/providers';
import {
  fixtureProviders,
  ledgers,
  metrics,
  ofEachSubscription,
  providerListOf,
  providerOf,
  providersOf,
  regions,
  tracker,
} from '@on.auto/providers/testing';
import {
  type ConnectionServer,
  type ConnectionServerSettings,
  type ConnectionUnready,
  readToolServerSettings,
} from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added, notes } from '../testing/additions.ts';
import { ada, developerTokenSet, harness, type Harness, harnessPages, operationNamed } from '../testing/harness.ts';
import { makeProviderResolver } from './provider-resolver.ts';

const issues = providerOf({ ...tracker, name: 'issues', aliases: ['tracker'] });

function serversNaming(provider: string) {
  const named = { provider, placeholders: { site: 'acme' }, credential: '${TRACKER_TOKEN}', org: 'acme' };
  return Effect.runSync(
    readToolServerSettings(
      { TRACKER_TOKEN: 'tracker-token-5e8a1f0c', TOOL_SERVERS: JSON.stringify({ named }) },
      { modelProviders: ['openai'], providers: makeProviderResolver(providerListOf(issues)) },
    ),
  ).servers;
}

describe('a provider the settings file names by another name its entry declares', () => {
  it('is the provider of that entry, its server served under the name it has now', () => {
    expect(serversNaming('tracker')).toMatchObject([
      { name: 'named', provider: 'issues', url: 'https://acme.tracker.example.com/mcp' },
    ]);
  });

  it('is served as before where the file names it by its own name', () => {
    const named = { provider: 'tracker', placeholders: { site: 'acme' }, credential: '${TRACKER_TOKEN}', org: 'acme' };
    const servers = Effect.runSync(
      readToolServerSettings(
        { TRACKER_TOKEN: 'tracker-token-5e8a1f0c', TOOL_SERVERS: JSON.stringify({ named }) },
        { modelProviders: ['openai'], providers: makeProviderResolver(fixtureProviders) },
      ),
    ).servers;

    expect(servers).toMatchObject([
      { name: 'named', provider: 'tracker', url: 'https://acme.tracker.example.com/mcp' },
    ]);
  });
});

const marking = providersOf(ledgers, metrics, regions, { ...tracker, marks: { reads: ['search_issues'] } });

async function preparedIn(
  h: Harness,
  id: string,
  providers: ProviderList,
): Promise<ConnectionServer | ConnectionUnready> {
  const source = makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    providers,
    providerValues: developerTokenSet,
    pages: harnessPages,
  });
  const listed = await Effect.runPromise(source.connectionsOf('acme'));
  const { state } = Option.getOrThrow(Option.fromNullishOr(listed.find((each) => each.id === id)));
  return state.status === 'connected'
    ? Effect.runPromise(
        Effect.match(state.server, {
          onSuccess: (server): ConnectionServer | ConnectionUnready => server,
          onFailure: (unready) => unready,
        }),
      )
    : state.unready;
}

async function settingsOf(
  h: Harness,
  id: string,
  providers: ProviderList,
): Promise<ConnectionServerSettings | ConnectionUnready> {
  const prepared = await preparedIn(h, id, providers);
  return 'settings' in prepared ? prepared.settings : prepared;
}

async function requestOriginsIn(h: Harness, id: string, providers: ProviderList) {
  const prepared = await preparedIn(h, id, providers);
  return 'requestOrigins' in prepared ? prepared.requestOrigins : prepared;
}

function marksInTheSettings(providers: ProviderList) {
  const servers = { issues: { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } } };
  const read = readToolServerSettings(
    { TOOL_SERVERS: JSON.stringify({ ...servers, issues: { ...servers.issues, org: 'acme' } }) },
    { modelProviders: ['openai'], providers: makeProviderResolver(providers) },
  );
  return Effect.runSync(read).servers.map(({ marks }) => marks);
}

describe('the marks of a provider, named in the settings', () => {
  it('are the marks of the tools its entry gives, and none where it gives none', () => {
    expect([marksInTheSettings(marking), marksInTheSettings(fixtureProviders)]).toEqual([
      [{ reads: ['search_issues'], acts: [] }],
      [{ reads: [], acts: [] }],
    ]);
  });
});

const trackerApp = providerOf({
  ...tracker,
  credentials: [
    {
      kind: 'client_credentials',
      issuer: 'https://auth.tracker.example.com',
      description: 'The client id and secret of an app your company registers at Tracker.',
    },
  ],
});

describe('a provider of client credentials to an MCP server, named in the settings', () => {
  it('is its server with its token asked at the issuer its way names', () => {
    const credential = { client_id: 'acme-app', client_secret: '${TRACKER_SECRET}' };
    const named = { provider: 'tracker', placeholders: { site: 'acme' }, credential, org: 'acme' };
    const read = readToolServerSettings(
      { TRACKER_SECRET: 'tracker-secret-0c41e9', TOOL_SERVERS: JSON.stringify({ named }) },
      { modelProviders: ['openai'], providers: makeProviderResolver(providerListOf(trackerApp)) },
    );

    expect(Effect.runSync(read).servers).toMatchObject([
      { type: 'mcp', auth: { issuer: 'https://auth.tracker.example.com', client_id: 'acme-app', discovery: 'issuer' } },
    ]);
  });
});

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

const coding = providersOf(ledgers, metrics, { ...regions, failure_codes: failureCodes }, tracker);

const regionsAdded = { provider: 'regions', placeholders: { region: 'eu', account: 'acme1' } };

describe('the failure codes of a provider', () => {
  it('are those its entry gives, for a server named in the settings and for a connection added by it alike, and none where it gives none', async () => {
    const read = (providers: ProviderList) =>
      Effect.runSync(
        readToolServerSettings(
          {
            TOOL_SERVERS: JSON.stringify({ campaigns: { ...regionsAdded, credential: '${REGIONS_KEY}', org: 'acme' } }),
            REGIONS_KEY: 'regions-key-5d1e',
          },
          { modelProviders: ['openai'], providers: makeProviderResolver(providers) },
        ),
      ).servers;
    const h = harness();
    const { id, token } = await added(h, { ...regionsAdded, credential: { kind: 'secret' } });
    await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'regions-key-5d1e' });

    expect([...read(coding), ...read(fixtureProviders)]).toMatchObject([
      { failure_codes: failureCodes },
      { failure_codes: null },
    ]);
    expect([await settingsOf(h, id, coding), await settingsOf(h, id, fixtureProviders)]).toMatchObject([
      { provider: 'regions', failure_codes: failureCodes },
      { provider: 'regions', failure_codes: null },
    ]);
  });
});

const trackerNowAnApi: Provider = {
  entry: {
    ...tracker,
    type: 'openapi',
    document: 'https://tracker.example.com/openapi.json',
    failure_codes: failureCodes,
  },
  address: 'https://tracker.example.com/openapi.json',
};

describe('a connection recorded as an MCP server from a provider that is an HTTP API since', () => {
  it('is refused in words that tell the person who added it to remove it and add it again', async () => {
    const h = harness();
    const tracked = { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } };
    const { id, token } = await added(h, tracked);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
    const others = fixtureProviders.providers.filter(({ entry }) => entry.name !== 'tracker');

    const served = await settingsOf(h, id, providerListOf(...others, trackerNowAnApi));

    expect(served).toEqual({
      because: 'connection_not_allowed',
      detail:
        'The entry of the connection tracker is not one this runtime takes any more: Its provider reaches an HTTP API now, where the connection was made for an MCP server, so the person who added it removes it and adds it again',
    });
  });
});

describe('the marks of a connection added by a provider', () => {
  it('are those the entry of its provider gives when it is served, and none for a connection given by hand', async () => {
    const h = harness();
    const tracked = await added(h, {
      provider: 'tracker',
      placeholders: { site: 'acme' },
      credential: { kind: 'none' },
    });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: tracked.id, token: tracked.token });
    const byHand = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: byHand.id, token: byHand.token });

    expect([
      await settingsOf(h, tracked.id, fixtureProviders),
      await settingsOf(h, tracked.id, marking),
      await settingsOf(h, byHand.id, marking),
    ]).toMatchObject([
      { provider: 'tracker', marks: { reads: [], acts: [] } },
      { provider: 'tracker', marks: { reads: ['search_issues'], acts: [] } },
      { provider: null, marks: { reads: [], acts: [] } },
    ]);
  });
});

describe('the origins of the requests of a connection added by a provider', () => {
  it("are those its provider's entry declares, whatever its placeholders were given, and none for a connection given by hand", async () => {
    const hearing = providersOf(ledgers, metrics, regions, {
      ...tracker,
      events: { destinations: [ofEachSubscription] },
    });
    const h = harness({ providers: hearing });
    const tracked = await added(h, {
      provider: 'tracker',
      placeholders: { site: 'elsewhere' },
      credential: { kind: 'none' },
    });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: tracked.id, token: tracked.token });
    const byHand = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: byHand.id, token: byHand.token });

    expect([
      await requestOriginsIn(h, tracked.id, hearing),
      await requestOriginsIn(h, byHand.id, hearing),
      await requestOriginsIn(h, tracked.id, fixtureProviders),
    ]).toEqual([['https://api.tracker.example.com'], [], []]);
  });
});
