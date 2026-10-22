import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { keptSecretOf, secretIdOf, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const crm = {
  name: 'crm',
  type: 'mcp',
  entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
};

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

    expect(answer).toMatchObject({ status: 201, body: { id, name: 'crm', status: 'pending', added_by: 'local' } });
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
      CONNECTIONS: JSON.stringify({ credential_kinds: ['none'] }),
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
