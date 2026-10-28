import { localDeveloper } from '@on.auto/identity/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { keptSecretOf, secretIdOf, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { connectionsAllowing } from '../testing/servers/loopback-connections.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const crm = {
  name: 'crm',
  type: 'mcp',
  entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
};

const DetailSchema = Schema.Struct({ detail: Schema.String });

const AddedSchema = Schema.Struct({
  id: Schema.String,
  connect: Schema.Struct({ url: Schema.String, expires_at: Schema.String }),
});

let server: ReasoningServer | undefined;
let ledger: TemporaryLedger | undefined;

afterEach(async () => {
  await server?.stop();
  ledger?.remove();
});

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  ledger = temporaryLedger();
  server = await servingReasoning([], {
    LEDGER_FILE: ledger.fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...connectionsAllowing(['crm.example.com']),
    ...environment,
  });
  return server;
}

async function added(served: ReasoningServer, body: unknown = crm) {
  const answer = await served.call('POST', connections, { body });
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
  const page = new URL(connect.url);
  const { token } = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }))(
    Object.fromEntries(page.searchParams),
  );
  return { answer, id, page, token, expiresAt: connect.expires_at };
}

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
      { credential: crm.credential, credential_ends_with: '0f3c' },
      { connections: [{ credential_ends_with: '0f3c' }] },
    ]);
    expect(again.status).toBe(404);
    expect(removed).toMatchObject({ status: 200, body: { status: 'removed', credential_ends_with: null } });
    expect(await keptSecretOf(fileName, secretId)).toEqual({ value: undefined, endsWith: undefined });
  });

  it('approves one that takes no credential to give', async () => {
    const served = await serving();
    const { id, token } = await added(served, { ...crm, credential: { kind: 'none' } });

    expect(await served.call('POST', `${connections}/${id}/approve`, { body: { token } })).toMatchObject({
      status: 200,
      body: { status: 'connected' },
    });
  });
});

describe('the rules of the runtime over HTTP', () => {
  it('answers 403 with the sentence of a rule the policy holds, and 409 for the name of an entry of the configuration', async () => {
    const served = await serving({
      ...connectionsAllowing(['crm.example.com'], { credential_kinds: ['none'] }),
      TOOL_SERVERS: JSON.stringify({ wiki: { url: 'http://127.0.0.1:9/mcp', org: 'local' } }),
    });

    const refused = await served.call('POST', connections, { body: crm });
    const taken = await served.call('POST', connections, {
      body: { ...crm, name: 'wiki', credential: { kind: 'none' } },
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

describe('the hosts of a runtime whose operator names none, over HTTP', () => {
  it('answers 403 for a server at a private, link-local or cloud metadata address, and 201 at a public one', async () => {
    const served = await serving({ CONNECTIONS: '' });

    const refused = await Promise.all(
      refusedAddresses.map(([url]) => served.call('POST', connections, { body: mcpServerAt(url) })),
    );

    expect(refused.map((answer) => detailOf(answer))).toEqual(
      refusedAddresses.map(([, host, kind]) => [403, refusalFor(host, kind)]),
    );
    expect(await served.call('POST', connections, { body: mcpServerAt('https://8.8.8.8/mcp') })).toMatchObject({
      status: 201,
    });
  });

  it('answers 201 for a server on loopback, since this runtime is local', async () => {
    const served = await serving({ CONNECTIONS: '' });

    expect(await served.call('POST', connections, { body: mcpServerAt('http://127.0.0.1:8443/mcp') })).toMatchObject({
      status: 201,
    });
  });

  it('answers 201 for headers to a public host', async () => {
    const served = await serving({ CONNECTIONS: '' });

    expect(await served.call('POST', connections, { body: crm })).toMatchObject({ status: 201 });
  });

  it('answers 403 for headers to a server at an address its operator did not name', async () => {
    const served = await serving({ CONNECTIONS: '' });
    const intranet = { ...crm, entry: { ...crm.entry, url: 'https://10.0.0.5/mcp' } };

    expect(detailOf(await served.call('POST', connections, { body: intranet }))).toEqual([
      403,
      refusalFor('10.0.0.5', 'a private address'),
    ]);
  });

  it('takes a server at a private address its operator names, headers or not', async () => {
    const served = await serving(connectionsAllowing(['10.0.0.5']));
    const intranet = { ...crm, entry: { ...crm.entry, url: 'https://10.0.0.5/mcp' } };

    expect(await served.call('POST', connections, { body: intranet })).toMatchObject({ status: 201 });
  });
});
