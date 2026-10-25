import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { servedForConsent, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { consentSecret } from '@on.auto/tool-servers/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { keptSecretOf, secretIdOf, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { connectedByConsent, linkAddedBy, servedStudioReturn } from '../testing/servers/consents-over-http.ts';
import { noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const crm = {
  name: 'crm',
  type: 'mcp',
  entry: { url: 'https://crm.example.com/mcp' },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
};

const byHand = {
  name: 'files',
  type: 'mcp',
  entry: { url: 'https://files.example.com/mcp' },
  credential: { kind: 'authorization', issuer: 'https://accounts.files.example.com' },
};

const consentByHand =
  'Expected another kind: consent is offered through a provider alone, so name the provider, as search lists it, in provider';

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([], { SECRETS_KEY: secretsKey.toString('base64') });
});

afterAll(async () => {
  await server.stop();
});

async function addedCrm() {
  return linkAddedBy(await server.call('POST', connections, { body: crm }));
}

describe('the start and the finish of a consent over HTTP', () => {
  it('are routes of the org bound to the link, refusing a connection that takes no consent and an unknown token', async () => {
    const { id, token } = await addedCrm();
    const finishing = { token, code: 'a-code', state: 'a-state' };

    const [started, finished, unknown] = [
      await server.call('POST', `${connections}/${id}/consent`, { body: { token } }),
      await server.call('POST', `${connections}/${id}/consent/code`, { body: finishing }),
      await server.call('POST', `${connections}/${id}/consent`, { body: { token: 'unknown' } }),
    ];

    expect([started, finished]).toMatchObject([
      {
        status: 409,
        body: {
          reason: 'conflict',
          detail:
            'The connection crm is not connected by signing in to its provider, so it has no consent to start or finish',
        },
      },
      { status: 409, body: { reason: 'conflict' } },
    ]);
    expect(unknown).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });

  it('are served to no agent, as the other routes of the link are not', async () => {
    const tools = await withMcpSession(
      'current revision',
      { url: `${server.origin}/mcp`, headers: {} },
      async (session) => toolNamesIn(await session.listTools()),
    );

    expect(tools.filter((name) => ['start', 'finish'].includes(name))).toEqual([]);
  });
});

describe('a connection of consent given by hand', () => {
  it('is refused over HTTP and over MCP at the kind of its credential, which the input takes by its name', async () => {
    const overHttp = await server.call('POST', connections, { body: byHand });
    const overMcp = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, (session) =>
      session.callTool('add_connection', byHand),
    );

    expect(overHttp).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/credential/kind', detail: consentByHand }] },
    });
    expect(overMcp).toMatchObject({ isError: true });
    expect(JSON.stringify(overMcp)).toContain(consentByHand);
  });
});

const anHour = 3_600_000;

const consentEnded =
  'The consent of the connection files was revoked or has ended, so the person who added it removes it and adds it again';

const KeptTokensSchema = Schema.fromJsonString(
  Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
);

function filesProvidedBy(fake: FakeMcpServer): Readonly<Record<string, string>> {
  return {
    CONNECTIONS: JSON.stringify({
      registered_clients: [
        { issuers: [fake.origin], client_id: 'auto-runtime', client_secret: '${FILES_CLIENT_SECRET}' },
      ],
      providers: [
        {
          name: 'files',
          title: 'Files',
          description: 'Read the files of an account.',
          website: 'https://developer.files.example.com',
          type: 'mcp',
          url: fake.url,
          credentials: [{ kind: 'authorization', issuer: fake.origin, scope: 'files.read' }],
        },
      ],
    }),
    FILES_CLIENT_SECRET: consentSecret,
  };
}

async function tokensKeptFor(fileName: string, id: string) {
  const secretId = String(await secretIdOf(fileName, 'local', id));
  return Schema.decodeUnknownSync(KeptTokensSchema)(String((await keptSecretOf(fileName, secretId)).value));
}

function revokedAt(fake: FakeMcpServer, refreshToken: string): Promise<Response> {
  return fetch(`${fake.origin}/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`auto-runtime:${consentSecret}`)}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
  });
}

function echoing(served: ReasoningServer) {
  return served.call('POST', '/v1/orgs/local/playbooks/alpha/tool-servers/files/tools/echo/execute', {
    body: { arguments: { said: 'hi' } },
  });
}

describe('a connection connected by consent over HTTP', () => {
  it('calls a tool with its access token, is renewed once it is due and broken once its grant is revoked', async () => {
    const { port, returnAddress } = await servedStudioReturn();
    const fake = await servedForConsent({ redirectUris: [returnAddress] });
    const ledger = temporaryLedger();
    const clock = movedClock(Date.now());
    const served = await servingReasoning(
      [],
      {
        PORT: String(port),
        LEDGER_FILE: ledger.fileName,
        SECRETS_KEY: secretsKey.toString('base64'),
        ...filesProvidedBy(fake),
      },
      noNetwork,
      { clock },
    );
    onTestFinished(async () => {
      await served.stop();
      await fake.close();
      ledger.remove();
    });
    await served.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const id = await connectedByConsent(served);
    const first = await tokensKeptFor(ledger.fileName, id);

    const called = await echoing(served);
    clock.moveTo(clock.now() + anHour);
    const renewedCall = await echoing(served);
    const renewed = await tokensKeptFor(ledger.fileName, id);
    await revokedAt(fake, renewed.refresh_token);
    const refused = await echoing(served);
    const read = await served.call('GET', `${connections}/${id}`);

    expect([called.body, renewedCall.body]).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }]);
    expect(renewed.access_token).not.toBe(first.access_token);
    expect(fake.seen().map(({ authorization }) => authorization)).toEqual(
      expect.arrayContaining([`Bearer ${first.access_token}`, `Bearer ${renewed.access_token}`]),
    );
    expect(refused.body).not.toMatchObject({ outcome: 'result' });
    expect(read.body).toMatchObject({ status: 'broken', broken: consentEnded });
    expect(JSON.stringify([called.body, renewedCall.body, refused.body, read.body])).not.toContain(
      renewed.refresh_token,
    );
  });
});
