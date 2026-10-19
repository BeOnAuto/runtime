import { toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/records/kept-credentials.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

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

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([], { SECRETS_KEY: secretsKey.toString('base64') });
});

afterAll(async () => {
  await server.stop();
});

async function addedCrm() {
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(
    (await server.call('POST', connections, { body: crm })).body,
  );
  return { id, token: String(new URL(connect.url).searchParams.get('token')) };
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
