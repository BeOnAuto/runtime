import { randomUUID } from 'node:crypto';

import { registeredClientSecrets } from '@on.auto/connections';
import { createApiKey } from '@on.auto/identity';
import { localDeveloper } from '@on.auto/identity/testing';
import { allPermissions } from '@on.auto/operations';
import { fixtureProviders } from '@on.auto/providers/testing';
import { serveFakeKms } from '@on.auto/secrets/served-fakes';
import { type FakeMcpServer, servedForConsent, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Option, Redacted, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  connectionFactsIn,
  keptSecretOf,
  secretIdOf,
  secretsKey,
  secretStoreInFile,
} from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { aSecretHeader, connectedWith } from '../testing/servers/connected-servers.ts';
import {
  connectedByConsent,
  filesProvidedBy,
  linkAddedBy,
  servedStudioReturn,
} from '../testing/servers/consents-over-http.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { connectionsAllowing, connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { alpha, noNetwork, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { readConnections, readConnectionSettings } from './connection-settings.ts';

const connections = '/v1/orgs/local/connections';

let crmServer: FakeMcpServer;

const crmCredential = {
  kind: 'secret',
  name: 'Authorization',
  in: 'header',
  instructions: 'Make a key in the CRM under **Settings**, [API keys](https://crm.example.com/settings/keys).',
  key_page: 'https://crm.example.com/settings/keys',
};

function crm() {
  return {
    name: 'crm',
    type: 'mcp',
    entry: { url: crmServer.url, headers: { 'X-Tenant': 'acme-eu' } },
    credential: crmCredential,
  };
}

const DetailSchema = Schema.Struct({ detail: Schema.String });

const AddedSchema = Schema.Struct({
  id: Schema.String,
  connect: Schema.Struct({ url: Schema.String, expires_at: Schema.String }),
});

let server: ReasoningServer | undefined;

let ledger: TemporaryLedger | undefined;

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  ledger = temporaryLedger();
  server = await servingReasoning([], {
    LEDGER_FILE: ledger.fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...connectionsOnLoopback,
    ...environment,
  });
  return server;
}

function linkedIn({ body }: TestResponse) {
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(body);
  const page = new URL(connect.url);
  const { token } = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }))(
    Object.fromEntries(page.searchParams),
  );
  return { id, page, token, expiresAt: connect.expires_at };
}

async function added(served: ReasoningServer, body: unknown = crm()) {
  const answer = await served.call('POST', connections, { body });
  return { answer, ...linkedIn(answer) };
}

const aDayInMilliseconds = 24 * 60 * 60 * 1000;

const refusedAddresses: readonly (readonly [string, string, string])[] = [
  ['https://10.0.0.5/mcp', '10.0.0.5', 'a private address'],
  ['https://169.254.169.254/latest/meta-data', '169.254.169.254', 'a cloud metadata address'],
  ['https://metadata.google.internal/computeMetadata/v1', 'metadata.google.internal', 'a cloud metadata host'],
];

const namedByTheOperator = ', unless its operator names the host in connections.allowed_hosts';

function refusalFor(host: string, kind: string): string {
  const unless = kind.startsWith('a cloud metadata') ? '' : namedByTheOperator;
  return `A connection may not reach the host ${host}, ${kind}${unless}`;
}

function mcpServerAt(url: string) {
  return { name: 'probe', type: 'mcp', entry: { url }, credential: { kind: 'none' } };
}

function detailOf({ status, body }: { readonly status: number; readonly body: unknown }) {
  return [status, Schema.decodeUnknownSync(DetailSchema)(body).detail];
}

const crmKey = 'crm-api-key-6e2b9d41';

const anotherKey = Buffer.alloc(32, 9);

const unreadableNow =
  'The credential of the connection crm cannot be read now. It stays connected: ask again later, and if it still cannot be read, whoever runs the runtime finds the cause in its log';

async function servedOn(
  fileName: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<ReasoningServer> {
  const serverConnectionsAcrossRestarts = await servingReasoning([], {
    LEDGER_FILE: fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...connectionsOnLoopback,
    ...environment,
  });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= serverConnectionsAcrossRestarts.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...serverConnectionsAcrossRestarts, stop };
}

async function connectedBeforeARestart(): Promise<{ readonly fileName: string; readonly id: string }> {
  const crmConnectionsAcrossRestarts = await serveFakeMcp({ bearer: crmKey });
  onTestFinished(crmConnectionsAcrossRestarts.close);
  ledger = temporaryLedger();
  const first = await servedOn(ledger.fileName);
  await first.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const id = await connectedWith(first, aSecretHeader('crm', crmConnectionsAcrossRestarts.url), `Bearer ${crmKey}`);
  await first.stop();
  return { fileName: ledger.fileName, id };
}

const echoing = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [crm/echo]', '---', 'Echo a note.'].join('\n');

async function ranEchoing(serverConnectionsAcrossRestarts: ReasoningServer) {
  await serverConnectionsAcrossRestarts.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source: echoing, diagram: 'none' },
  });
  return serverConnectionsAcrossRestarts.call('POST', `${alpha}/definitions/reasoning/echo/run`, {
    body: { input: {} },
  });
}

function executed(serverConnectionsAcrossRestarts: ReasoningServer) {
  return serverConnectionsAcrossRestarts.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, {
    body: { arguments: {} },
  });
}

async function sealedAgainUnder(fileName: string, id: string, key: Readonly<Uint8Array>, version: number) {
  const store = await secretStoreInFile(fileName, key);
  const secretId = Option.getOrThrow(Option.fromNullishOr(await secretIdOf(fileName, 'acme', id)));
  const replaced = await Effect.runPromise(store.replace(secretId, version, Redacted.make(`Bearer ${crmKey}`)));
  await store.close();
  return replaced;
}

const keyId = randomUUID();

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${keyId}`;

const fake = await serveFakeKms({ keys: [keyArn] });

const crmKeyConnectionsUnderKms = 'crm-api-key-5d1c7e20';

function kmsOfTheEnvironmentAtTheFake(): void {
  vi.stubEnv('AWS_ENDPOINT_URL_KMS', fake.url);
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key-of-the-tests');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key-of-the-tests');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

async function servedUnderTheKeyInKms(): Promise<ReasoningServer> {
  kmsOfTheEnvironmentAtTheFake();
  const serverConnectionsUnderKms = await servingReasoning([], { SECRETS_KEY_KMS: keyArn, ...connectionsOnLoopback });
  onTestFinished(serverConnectionsUnderKms.stop);
  await serverConnectionsUnderKms.call('POST', '/v1/orgs/acme/playbooks', {
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return serverConnectionsUnderKms;
}

function executedConnectionsUnderKms(serverConnectionsUnderKms: ReasoningServer) {
  return serverConnectionsUnderKms.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, {
    body: { arguments: {} },
  });
}

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

const clientSecret = 'billing-client-secret-3a9f71';

interface Serving {
  readonly server: ReasoningServer;
  readonly ledger: TemporaryLedger;
}

async function servingOver(
  fakeRefusedCredentials: FakeMcpServer,
  environment: Readonly<Record<string, string>>,
): Promise<Serving> {
  const ledgerRefusedCredentials = temporaryLedger();
  const serverRefusedCredentials = await servingReasoning(
    [],
    { SECRETS_KEY: secretsKey.toString('base64'), ...connectionsOnLoopback, ...environment },
    noNetwork,
    {
      ledger: ledgerRefusedCredentials,
    },
  );
  onTestFinished(async () => {
    await serverRefusedCredentials.stop();
    await fakeRefusedCredentials.close();
    ledgerRefusedCredentials.remove();
  });
  await serverRefusedCredentials.call('POST', '/v1/orgs/local/playbooks', {
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return { server: serverRefusedCredentials, ledger: ledgerRefusedCredentials };
}

function echoingRefusedCredentials(serverRefusedCredentials: ReasoningServer, name: string) {
  return serverRefusedCredentials.call(
    'POST',
    `/v1/orgs/local/playbooks/alpha/tool-servers/${name}/tools/echo/execute`,
    {
      body: { arguments: { said: 'hi' } },
    },
  );
}

function callsAt(fakeRefusedCredentials: FakeMcpServer): number {
  return fakeRefusedCredentials.seen().filter(({ rpc }) => rpc === 'tools/call').length;
}

async function refusedTwiceAfterACall(
  { server: serverRefusedCredentials, ledger: ledgerRefusedCredentials }: Serving,
  fakeRefusedCredentials: FakeMcpServer,
  name: string,
  id: string,
) {
  const answered = await echoingRefusedCredentials(serverRefusedCredentials, name);
  const [tokensBefore, callsBefore] = [fakeRefusedCredentials.tokenRequests(), callsAt(fakeRefusedCredentials)];
  fakeRefusedCredentials.answerNextOf('tools/call', 401, 2);
  const refused = await echoingRefusedCredentials(serverRefusedCredentials, name);
  return {
    answered: answered.body,
    refused: refused.body,
    tokensAsked: fakeRefusedCredentials.tokenRequests() - tokensBefore,
    callsSent: callsAt(fakeRefusedCredentials) - callsBefore,
    standing: (await serverRefusedCredentials.call('GET', `/v1/orgs/local/connections/${id}`)).body,
    breaks: (await connectionFactsIn(ledgerRefusedCredentials.fileName, 'local')).filter(
      (type) => type === 'connection_broken',
    ),
  };
}

function brokenOnce(name: string) {
  return {
    answered: { outcome: 'result' },
    refused: { outcome: 'server_failure', text: `The tool server ${name} failed: ${keyRefused}` },
    tokensAsked: 1,
    callsSent: 2,
    standing: { status: 'broken', broken: { kind: 'credential_refused', detail: keyRefused } },
    breaks: ['connection_broken'],
  };
}

const apiKey = 'graph-api-key-4f1d9a7c2b';

const clientSecretRegisteredClients = 'registered-client-secret-7e1d';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const connectionsRegisteredClients = JSON.stringify({
  registered_clients: [
    {
      issuers: ['https://accounts.example.com'],
      client_id: '1234.apps.example.com',
      client_secret: '${EXAMPLE_CLIENT_SECRET}',
    },
  ],
});

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
    ),
  }),
);

async function callEventsOf(serverRegisteredClients: ReasoningServer) {
  const page = await serverRegisteredClients.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
  const wholes = await Promise.all(
    decodeEvents(page.body).events.map(
      async ({ id }) => (await serverRegisteredClients.call('GET', `${alpha}/events/${id}`, { key: builder.key })).body,
    ),
  );
  return { page: page.body, wholes: decodeEvents({ events: wholes }).events };
}

const closing: (() => Promise<void>)[] = [];

const functions = readSettingsOf({});

describe('connections over http', () => {
  beforeAll(async () => {
    crmServer = await serveFakeMcp({ bearer: 'crm-0f3c' });
  });

  afterAll(async () => {
    await crmServer.close();
  });

  afterEach(async () => {
    await server?.stop();
    ledger?.remove();
  });

  describe('adding a connection over HTTP in local mode', () => {
    it("answers 201 with the record and a link to the page of the Studio the server serves, under the server's own address, naming the connection and its token alone", async () => {
      const served = await serving();

      const { answer, id, page, token } = await added(served);

      expect(answer).toMatchObject({
        status: 201,
        body: { id, name: 'crm', status: 'pending', added_by: { id: 'local', name: localDeveloper.name } },
      });
      expect(Object.fromEntries(page.searchParams)).toEqual({ connection: id, token });
      expect(`${page.origin}${page.pathname}`).toBe(`${served.origin}/studio/connect`);
    });

    it('lists the connection and reads it, and reads it through its link with when the link expires', async () => {
      const served = await serving();
      const { id, token, expiresAt } = await added(served);

      const [listed, read, linked] = [
        await served.call('GET', connections),
        await served.call('GET', `${connections}/${id}`),
        await served.call('GET', `${connections}/${id}/link/${token}`),
      ];

      expect(listed).toMatchObject({ status: 200, body: { connections: [{ id, name: 'crm', type: 'mcp' }] } });
      expect([read.body, linked.body]).toMatchObject([
        { id },
        { id, status: 'pending', link: { expires_at: expiresAt } },
      ]);
      expect((await served.call('GET', `${connections}/${id}/link/unknown`)).status).toBe(404);
    });
  });

  describe('reconnecting a connection over HTTP while its link is open', () => {
    it('answers 200 with a new link of 24 hours, which replaces the open one: the old token is not found, in words that say so', async () => {
      const served = await serving();
      const first = await added(served);
      const before = Date.now();

      const answer = await served.call('POST', `${connections}/${first.id}/link`);
      const latest = linkedIn(answer);
      const [old, current] = [
        await served.call('GET', `${connections}/${first.id}/link/${first.token}`),
        await served.call('GET', `${connections}/${first.id}/link/${latest.token}`),
      ];

      expect(answer).toMatchObject({ status: 200, body: { id: first.id, status: 'pending' } });
      expect(Date.parse(latest.expiresAt) - before).toBeGreaterThanOrEqual(aDayInMilliseconds);
      expect(Date.parse(latest.expiresAt) - Date.now()).toBeLessThanOrEqual(aDayInMilliseconds);
      expect(detailOf(old)).toEqual([
        404,
        'There is no open link of this token: a newer link of the connection crm replaced it',
      ]);
      expect(current).toMatchObject({ status: 200, body: { id: first.id, link: { expires_at: latest.expiresAt } } });
    });
  });

  describe('giving the credential of a connection over HTTP', () => {
    it('connects it, keeps the value sealed and its ending beside it, uses the link up, and forgets both on removal', async () => {
      const served = await serving();
      const { id, token } = await added(served);
      const fileName = String(ledger?.fileName);

      const approval = await served.call('POST', `${connections}/${id}/approve`, { body: { token } });
      const given = await served.call('POST', `${connections}/${id}/credential`, {
        body: { token, value: 'Bearer crm-0f3c' },
      });
      const secretId = String(await secretIdOf(fileName, 'local', id));
      const keptBefore = await keptSecretOf(fileName, secretId);
      const [read, listed] = [await served.call('GET', `${connections}/${id}`), await served.call('GET', connections)];
      const again = await served.call('POST', `${connections}/${id}/credential`, { body: { token, value: 'x' } });
      const removed = await served.call('DELETE', `${connections}/${id}`);

      expect(approval).toMatchObject({ status: 409, body: { reason: 'conflict' } });
      expect(given).toMatchObject({ status: 200, body: { id, status: 'connected', credential_ends_with: '0f3c' } });
      expect(keptBefore).toEqual({ value: 'Bearer crm-0f3c', endsWith: '0f3c' });
      expect([read.body, listed.body]).toMatchObject([
        { credential: crmCredential, credential_ends_with: '0f3c' },
        { connections: [{ credential_ends_with: '0f3c' }] },
      ]);
      expect(again.status).toBe(404);
      expect(removed).toMatchObject({ status: 200, body: { status: 'removed', credential_ends_with: null } });
      expect(await keptSecretOf(fileName, secretId)).toEqual({ value: undefined, endsWith: undefined });
    });

    it('approves one that takes no credential to give', async () => {
      const served = await serving();
      const { id, token } = await added(served, { ...crm(), credential: { kind: 'none' } });

      expect(await served.call('POST', `${connections}/${id}/approve`, { body: { token } })).toMatchObject({
        status: 200,
        body: { status: 'connected' },
      });
    });
  });

  describe('the rules of the runtime over HTTP', () => {
    it('answers 403 with the sentence of a rule the policy holds, and 409 for the name of an entry of the configuration', async () => {
      const served = await serving({
        ...connectionsAllowing(['127.0.0.1'], { credential_kinds: ['none'] }),
        TOOL_SERVERS: JSON.stringify({ wiki: { url: 'http://127.0.0.1:9/mcp', org: 'local' } }),
      });

      const refused = await served.call('POST', connections, { body: crm() });
      const taken = await served.call('POST', connections, {
        body: { ...crm(), name: 'wiki', credential: { kind: 'none' } },
      });

      expect(refused).toMatchObject({
        status: 403,
        body: {
          detail: 'A connection may not take a secret credential on this runtime, which allows none',
        },
      });
      expect(taken).toMatchObject({ status: 409, body: { kind: 'taken' } });
    });
  });

  describe('the hosts of a runtime whose operator names none, over HTTP', () => {
    it('answers 403 for a server at a private, link-local or cloud metadata address', async () => {
      const served = await serving({ CONNECTIONS: '' });

      const refused = await Promise.all(
        refusedAddresses.map(([url]) => served.call('POST', connections, { body: mcpServerAt(url) })),
      );

      expect(refused.map((answer) => detailOf(answer))).toEqual(
        refusedAddresses.map(([, host, kind]) => [403, refusalFor(host, kind)]),
      );
    });

    it('answers 201 for a server on loopback, headers or not, since this runtime is local', async () => {
      const served = await serving({ CONNECTIONS: '' });

      expect([
        await served.call('POST', connections, { body: mcpServerAt(crmServer.url) }),
        await served.call('POST', connections, { body: crm() }),
      ]).toMatchObject([{ status: 201 }, { status: 201 }]);
    });

    it('answers 403 for headers to a server at an address its operator did not name', async () => {
      const served = await serving({ CONNECTIONS: '' });
      const intranet = { ...crm(), entry: { ...crm().entry, url: 'https://10.0.0.5/mcp' } };

      expect(detailOf(await served.call('POST', connections, { body: intranet }))).toEqual([
        403,
        refusalFor('10.0.0.5', 'a private address'),
      ]);
    });
  });
});

describe('connections across restarts', () => {
  afterEach(() => {
    ledger?.remove();
  });

  describe('a connection whose credential the secret store of a restarted runtime cannot read now', () => {
    it('is refused unavailable in the words of the store and listed so, stays connected with nothing recorded, and is called once the credential can be read again', async () => {
      const { fileName, id } = await connectedBeforeARestart();
      await sealedAgainUnder(fileName, id, anotherKey, 1);
      const restarted = await servedOn(fileName);

      const refused = await executed(restarted);
      const ran = await ranEchoing(restarted);
      const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);
      const read = await restarted.call('GET', `/v1/orgs/acme/connections/${id}`);
      const sealedAgain = await sealedAgainUnder(fileName, id, secretsKey, 2);
      const called = await executed(restarted);

      expect(refused).toMatchObject({
        status: 503,
        body: { kind: 'tool_not_offered', because: 'connection_unavailable', detail: unreadableNow },
      });
      expect(refused.headers.get('retry-after')).toBeNull();
      expect(ran).toMatchObject({
        status: 503,
        body: {
          reason: 'unavailable',
          kind: 'tool_not_offered',
          because: 'connection_unavailable',
          detail: unreadableNow,
        },
      });
      expect(searched.body).toMatchObject({
        servers: [{ name: 'crm', connection: id, because: 'connection_unavailable', unavailable: unreadableNow }],
      });
      expect(read.body).toMatchObject({ status: 'connected' });
      expect(sealedAgain).toEqual({ replaced: true, version: 3 });
      expect(called.status).toBe(200);
      expect(await connectionFactsIn(fileName, 'acme')).not.toContain('connection_broken');
    });
  });

  describe('a connection the rules of a restarted runtime no longer allow', () => {
    it('is refused in the sentence of the rule, as adding it would be, and listed unavailable in it', async () => {
      const { fileName } = await connectedBeforeARestart();
      const restarted = await servedOn(fileName, connectionsAllowing(['127.0.0.1'], { credential_kinds: ['none'] }));
      const rule = 'A connection may not take a secret credential on this runtime, which allows none';

      const refused = await executed(restarted);
      const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);

      expect(refused).toMatchObject({
        status: 503,
        body: { kind: 'tool_not_offered', because: 'connection_not_allowed', detail: rule },
      });
      expect(searched.body).toMatchObject({
        servers: [{ name: 'crm', because: 'connection_not_allowed', unavailable: rule }],
      });
    });
  });
});

describe('connections under kms', () => {
  afterAll(fake.close);

  describe('a connection whose credential is sealed under a key in KMS that is disabled meanwhile', () => {
    it('fails its call as connection_unavailable in the words of KMS, stays connected, and is called once the key is enabled again', async () => {
      const crmConnectionsUnderKms = await serveFakeMcp({ bearer: crmKeyConnectionsUnderKms });
      onTestFinished(crmConnectionsUnderKms.close);
      const serverConnectionsUnderKms = await servedUnderTheKeyInKms();
      const id = await connectedWith(
        serverConnectionsUnderKms,
        aSecretHeader('crm', crmConnectionsUnderKms.url),
        `Bearer ${crmKeyConnectionsUnderKms}`,
      );

      fake.tell(keyArn, 'disabled');
      onTestFinished(() => {
        fake.tell(keyArn, 'enabled');
      });
      const refused = await executedConnectionsUnderKms(serverConnectionsUnderKms);
      const read = await serverConnectionsUnderKms.call('GET', `/v1/orgs/acme/connections/${id}`);
      fake.tell(keyArn, 'enabled');
      const called = await executedConnectionsUnderKms(serverConnectionsUnderKms);

      expect(refused).toMatchObject({
        status: 503,
        body: {
          kind: 'tool_not_offered',
          because: 'connection_unavailable',
          detail:
            'The credential of the connection crm cannot be read now. It stays connected: ask again later, and if it still cannot be read, whoever runs the runtime finds the cause in its log',
        },
      });
      expect(read.body).toMatchObject({ status: 'connected' });
      expect(called.status).toBe(200);
      expect(new Set(fake.calls().map(({ keyId: asked, context }) => `${asked} ${JSON.stringify(context)}`))).toEqual(
        new Set([`${keyArn} {"on.auto/runtime":"secret data key"}`]),
      );
    });
  });
});

describe('a connection of client credentials whose server answers 401 to its token', () => {
  it('asks for a new token and tries once more, and is broken by the second 401, recorded once', async () => {
    const fakeRefusedCredentials = await serveFakeMcp({
      client: { clientId: 'billing', clientSecret, expiresInSeconds: 3600 },
    });
    const servingRefusedCredentials = await servingOver(fakeRefusedCredentials, {});
    const { id, token } = linkAddedBy(
      await servingRefusedCredentials.server.call('POST', '/v1/orgs/local/connections', {
        body: {
          name: 'billing',
          type: 'mcp',
          entry: { url: fakeRefusedCredentials.url },
          credential: { kind: 'client_credentials', issuer: fakeRefusedCredentials.origin, client_id: 'billing' },
        },
      }),
    );
    await servingRefusedCredentials.server.call('POST', `/v1/orgs/local/connections/${id}/credential`, {
      body: { token, client_secret: clientSecret },
    });

    expect(
      await refusedTwiceAfterACall(servingRefusedCredentials, fakeRefusedCredentials, 'billing', id),
    ).toMatchObject(brokenOnce('billing'));
  });
});

describe('a connection connected by consent whose server answers 401 to its token', () => {
  it('renews its tokens and tries once more, and is broken by the second 401, recorded once', async () => {
    const { port, returnAddress } = await servedStudioReturn();
    const fakeRefusedCredentials = await servedForConsent({ redirectUris: [returnAddress] });
    const servingRefusedCredentials = await servingOver(fakeRefusedCredentials, {
      PORT: String(port),
      ...filesProvidedBy(fakeRefusedCredentials),
    });
    const id = await connectedByConsent(servingRefusedCredentials.server);

    expect(await refusedTwiceAfterACall(servingRefusedCredentials, fakeRefusedCredentials, 'files', id)).toMatchObject(
      brokenOnce('files'),
    );
  });
});

describe('registered clients', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('the registered clients of a server', () => {
    it('are among its settings, each secret redacted', () => {
      const { registeredClients } = readSettingsOf({
        CONNECTIONS: connectionsRegisteredClients,
        EXAMPLE_CLIENT_SECRET: clientSecretRegisteredClients,
      });

      expect(registeredClients).toMatchObject([
        { clientId: '1234.apps.example.com', credential: { kind: 'client_secret' } },
      ]);
      expect(JSON.stringify(registeredClients)).not.toContain(clientSecretRegisteredClients);
      expect(registeredClientSecrets(registeredClients).map((secret) => Redacted.value(secret))).toEqual([
        clientSecretRegisteredClients,
      ]);
      expect(readSettingsOf({}).registeredClients).toEqual([]);
    });

    it('have their secrets scrubbed from what a call answers and from what it records, as the secrets of its tool servers are', async () => {
      const graph = await serveFakeMcp({ bearer: apiKey });
      closing.push(graph.close);
      const serverRegisteredClients = await servingReasoning([], {
        API_KEYS: JSON.stringify([builder.entry]),
        GRAPH_API_KEY: apiKey,
        TOOL_SERVERS: JSON.stringify({
          graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
        }),
        CONNECTIONS: connectionsRegisteredClients,
        EXAMPLE_CLIENT_SECRET: clientSecretRegisteredClients,
      });
      closing.push(serverRegisteredClients.stop);
      await serverRegisteredClients.call('POST', '/v1/orgs/acme/playbooks', {
        key: builder.key,
        body: { playbook: 'alpha', name: 'Alpha' },
      });

      const echoed = await serverRegisteredClients.call('POST', `${alpha}/tool-servers/graph/tools/echo/execute`, {
        key: builder.key,
        body: { arguments: { said: `the secret is ${clientSecretRegisteredClients}` } },
      });

      const { page, wholes } = await callEventsOf(serverRegisteredClients);
      const scrubbed = { said: 'the secret is [redacted]' };

      expect(echoed).toMatchObject({ status: 200, body: { outcome: 'result', text: JSON.stringify(scrubbed) } });
      expect(wholes.map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
      expect(wholes[0]?.data['arguments']).toEqual(scrubbed);
      expect(wholes[1]?.data['result']).toMatchObject({ content: [{ type: 'text', text: JSON.stringify(scrubbed) }] });
      expect(JSON.stringify([echoed.body, page, wholes])).not.toContain(clientSecretRegisteredClients);
      expect(graph.received()).toMatchObject([{ tool: 'echo' }]);
    });
  });
});

describe('the values the operator sets for the providers', () => {
  it('are read from the environment for each variable a provider refers to, and for no other', () => {
    const environment = { METRICS_DEVELOPER_TOKEN: 'metrics-developer-token-0123', UNRELATED_TOKEN: 'unrelated-0123' };
    const read = readConnections(environment, undefined, fixtureProviders);
    const { providerValues } = readConnectionSettings(environment, undefined, functions, read);

    expect(
      [...providerValues].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
    ).toEqual([['METRICS_DEVELOPER_TOKEN', 'metrics-developer-token-0123']]);
  });

  it('name variables the runtime reads for itself, which connections.variables may not name', () => {
    const naming = { CONNECTIONS: JSON.stringify({ variables: ['METRICS_DEVELOPER_TOKEN'] }) };
    const read = readConnections(naming, undefined, fixtureProviders);

    expect(() => readConnectionSettings(naming, undefined, functions, read)).toThrow(
      'METRICS_DEVELOPER_TOKEN is a variable the runtime reads for itself, which no connection may name',
    );
  });
});
