import type { ProviderList } from '@on.auto/providers';
import { fixtureProviders, providerListOf, providerOf, providersOf } from '@on.auto/providers/testing';
import {
  shippedDocumentOf,
  type ConnectionServerSettings,
  type ConnectionUnready,
  type OrgConnection,
} from '@on.auto/tool-servers';
import { fakeApiDocument } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added, adding, issuesIn, notes } from '../testing/additions.ts';
import {
  ada,
  developerToken,
  developerTokenSet,
  harness,
  harnessPages,
  operationNamed,
  type Harness,
} from '../testing/harness.ts';

const acmeLedgers = { provider: 'ledgers', placeholders: { tenant: 'acme', manager: '1234567890' } };

const clientId = 'acme-ledgers-client';

const metricsKey = 'metrics-key-of-the-person';

interface Serving {
  readonly providerValues?: ReadonlyMap<string, Redacted.Redacted>;
  readonly allowedHosts?: readonly string[];
  readonly providers?: ProviderList;
}

function listedBy(
  h: Harness,
  { providerValues = developerTokenSet, allowedHosts, providers = fixtureProviders }: Serving = {},
): Promise<readonly OrgConnection[]> {
  const source = makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf(allowedHosts === undefined ? {} : { allowed_hosts: allowedHosts }),
    variables: new Map(),
    modelProviders: ['openai'],
    providers,
    providerValues,
    pages: harnessPages,
  });
  return Effect.runPromise(source.connectionsOf('acme'));
}

async function settingsOf(
  h: Harness,
  id: string,
  serving: Serving = {},
): Promise<ConnectionServerSettings | ConnectionUnready> {
  const listed = await listedBy(h, serving);
  const { state } = Option.getOrThrow(Option.fromNullishOr(listed.find((each) => each.id === id)));
  return state.status === 'connected'
    ? Effect.runPromise(
        Effect.match(state.server, {
          onSuccess: ({ settings }): ConnectionServerSettings | ConnectionUnready => settings,
          onFailure: (unready) => unready,
        }),
      )
    : state.unready;
}

function headersOf(settings: ConnectionServerSettings | ConnectionUnready): Readonly<Record<string, string>> {
  return 'headers' in settings
    ? Object.fromEntries(
        [...settings.headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [
          name,
          Redacted.value(value),
        ]),
      )
    : {};
}

function secretsOf(settings: ConnectionServerSettings | ConnectionUnready): readonly string[] {
  return 'secrets' in settings ? settings.secrets.map((secret) => Redacted.value(secret)) : [];
}

describe('a connection added by a provider of client credentials', () => {
  it('records {client_id} as the provider writes it, and is served with the client id the person gave on the page, in the open', async () => {
    const h = harness();
    const { id, token } = await added(h, acmeLedgers);

    const given = await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id,
      token,
      client_id: clientId,
      client_secret: 'ledgers-secret-0123456789',
    });
    const served = await settingsOf(h, id);

    expect(given).toMatchObject({
      status: 'succeeded',
      output: {
        provider: 'ledgers',
        entry: { headers: { 'X-Client': '{client_id}', 'X-Manager': '1234567890', 'X-Format': 'json' } },
        credential: {
          kind: 'client_credentials',
          issuer: 'https://auth.ledgers.example.com/acme',
          client_id: clientId,
        },
        status: 'connected',
      },
    });
    expect(headersOf(served)).toEqual({ 'X-Client': clientId, 'X-Manager': '1234567890', 'X-Format': 'json' });
    expect(served).toMatchObject({ base_url: 'https://api.ledgers.example.com/acme/v2', request_id: 'X-Request-Id' });
    expect(secretsOf(served)).not.toContain(clientId);
  });
});

describe('the client id a person gives on the page for a provider of client credentials', () => {
  it('is served holding ${…} and {…} as the person gave it, which no reference or placeholder reads', async () => {
    const h = harness();
    const { id, token } = await added(h, acmeLedgers);
    const written = '${LEDGERS_CLIENT}{tenant}';

    await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id,
      token,
      client_id: written,
      client_secret: 'ledgers-secret-0123456789',
    });

    expect(headersOf(await settingsOf(h, id))).toMatchObject({ 'X-Client': written });
  });

  it('refuses on the page a client id that looks like a credential, as one given by hand', async () => {
    const h = harness();
    const { id, token } = await added(h, acmeLedgers);

    expect(
      await h.call(operationNamed(h.operations, 'give_credential'), ada, {
        id,
        token,
        client_id: 'sk-live-0123456789abcdefghij',
        client_secret: 'ledgers-secret-0123456789',
      }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/client_id' }] });
  });
});

describe('a connection added by a provider that sends a value of the operator', () => {
  it('records the reference as the provider writes it, and is served with the value, a secret, beside the credential', async () => {
    const h = harness({ providerValues: developerTokenSet });
    const { id, token } = await added(h, { provider: 'metrics' });

    const given = await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: metricsKey });
    const served = await settingsOf(h, id);

    expect(given).toMatchObject({
      output: { entry: { headers: { 'X-Developer-Token': '${METRICS_DEVELOPER_TOKEN}' } }, status: 'connected' },
    });
    expect(headersOf(served)).toEqual({ 'X-Developer-Token': developerToken, Authorization: `Bearer ${metricsKey}` });
    expect(secretsOf(served)).toEqual(expect.arrayContaining([developerToken, metricsKey]));
  });

  it('is refused at /provider where the value is not set, and served as not allowed once it is unset', async () => {
    const h = harness({ providerValues: developerTokenSet });
    const { id, token } = await added(h, { provider: 'metrics' });
    await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: metricsKey });

    expect([
      issuesIn(await adding(harness(), { provider: 'metrics' })),
      await settingsOf(h, id, { providerValues: new Map() }),
    ]).toEqual([
      [
        {
          pointer: '/provider',
          detail: 'Refers to the environment variable METRICS_DEVELOPER_TOKEN, which is not set',
        },
      ],
      {
        because: 'connection_not_allowed',
        detail:
          'The entry of the connection metrics is not one this runtime takes any more: Refers to the environment variable METRICS_DEVELOPER_TOKEN, which is not set',
      },
    ]);
  });
});

const reports = {
  name: 'reports',
  title: 'Reports',
  description: 'Read the reports of your account.',
  website: 'https://developer.reports.example.com',
  type: 'openapi',
  document: 'https://reports.example.com/openapi.json',
  base_url: 'https://api.reports.example.com/v1',
  query_params: { developer_token: '${REPORTS_DEVELOPER_TOKEN}', format: 'json' },
  credentials: [{ kind: 'none' }],
};

const { base_url: _baseUrl, ...unbasedNotes } = {
  name: 'notes-api',
  title: 'Notes',
  description: 'Read notes.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/notes-api.openapi.json',
  base_url: 'https://api.notes.example.org/v1',
  credentials: [{ kind: 'none' }],
};

describe('a provider whose document beside the entries names its server', () => {
  it('has the host of that server judged where it gives no base_url, at add and at use', async () => {
    const server = 'https://api.notes.example.com/v1';
    const providers = {
      ...providerListOf(providerOf(unbasedNotes, server)),
      documents: new Map([
        [
          unbasedNotes.document,
          shippedDocumentOf(new TextEncoder().encode(JSON.stringify(fakeApiDocument('3.1', server)))),
        ],
      ]),
    };
    const h = harness({ providers });
    const { id, token } = await added(h, { provider: 'notes-api' });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
    const detail =
      'A connection may not reach the host api.notes.example.com on this runtime, which allows *.example.org';

    expect([
      await adding(harness({ providers, policy: connectionPolicyOf({ allowed_hosts: ['*.example.org'] }) }), {
        provider: 'notes-api',
      }),
      await settingsOf(h, id, { providers, allowedHosts: ['*.example.org'] }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'forbidden', detail },
      { because: 'connection_not_allowed', detail },
    ]);
  });
});

describe('a provider that sends a value of the operator in its query', () => {
  it('is added with the reference in its query parameters, as the provider writes it', async () => {
    const h = harness({
      providers: providersOf(reports),
      providerValues: new Map([['REPORTS_DEVELOPER_TOKEN', Redacted.make('reports-developer-token-0123')]]),
    });

    expect(await adding(h, { provider: 'reports' })).toMatchObject({
      status: 'succeeded',
      output: { entry: { query_params: { developer_token: '${REPORTS_DEVELOPER_TOKEN}', format: 'json' } } },
    });
  });
});

describe('a connection added by a provider, as a tool server', () => {
  it('is served with the name of its provider, pending, connected and broken, and one given by hand with none', async () => {
    const h = harness();
    const tracked = { provider: 'tracker', placeholders: { site: 'acme' } };
    const pending = await added(h, { ...tracked, name: 'issues' });
    const approved = await added(h, { ...tracked, name: 'board', credential: { kind: 'none' } });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: approved.id, token: approved.token });
    const broken = await added(h, { ...tracked, name: 'tasks' });
    await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id: broken.id,
      token: broken.token,
      value: 'tracker-token-0f3c9a71',
    });
    await Effect.runPromise(h.secrets.forget('secret-1'));
    await settingsOf(h, broken.id);
    const byHand = await added(h, notes);

    const listed = await listedBy(h);

    expect(listed.map(({ id, serving, state }) => [id, serving.provider, state])).toMatchObject([
      [byHand.id, null, { status: 'unready', unready: { because: 'connection_pending' } }],
      [broken.id, 'tracker', { status: 'unready', unready: { because: 'connection_broken' } }],
      [approved.id, 'tracker', { status: 'connected' }],
      [pending.id, 'tracker', { status: 'unready', unready: { because: 'connection_pending' } }],
    ]);
  });

  it('is served by settings that carry the name of its provider, as its serving does, and one given by hand by none', async () => {
    const h = harness();
    const tracked = await added(h, {
      provider: 'tracker',
      placeholders: { site: 'acme' },
      credential: { kind: 'none' },
    });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: tracked.id, token: tracked.token });
    const byHand = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: byHand.id, token: byHand.token });

    expect([await settingsOf(h, tracked.id), await settingsOf(h, byHand.id)]).toMatchObject([
      { name: 'tracker', provider: 'tracker' },
      { name: 'notes', provider: null },
    ]);
  });
});
