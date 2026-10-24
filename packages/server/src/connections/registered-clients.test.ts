import { registeredClientSecrets } from '@on.auto/connections';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Redacted, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const clientSecret = 'registered-client-secret-7e1d';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const connections = JSON.stringify({
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

async function callEventsOf(server: ReasoningServer) {
  const page = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
  const wholes = await Promise.all(
    decodeEvents(page.body).events.map(
      async ({ id }) => (await server.call('GET', `${alpha}/events/${id}`, { key: builder.key })).body,
    ),
  );
  return { page: page.body, wholes: decodeEvents({ events: wholes }).events };
}

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('the registered clients of a server', () => {
  it('are among its settings, each secret redacted', () => {
    const { registeredClients } = readSettingsOf({ CONNECTIONS: connections, EXAMPLE_CLIENT_SECRET: clientSecret });

    expect(registeredClients).toMatchObject([
      { clientId: '1234.apps.example.com', credential: { kind: 'client_secret' } },
    ]);
    expect(JSON.stringify(registeredClients)).not.toContain(clientSecret);
    expect(registeredClientSecrets(registeredClients).map((secret) => Redacted.value(secret))).toEqual([clientSecret]);
    expect(readSettingsOf({}).registeredClients).toEqual([]);
  });

  it('have their secrets scrubbed from what a call answers and from what it records, as the secrets of its tool servers are', async () => {
    const graph = await serveFakeMcp({ bearer: apiKey });
    closing.push(graph.close);
    const server = await servingReasoning([], {
      API_KEYS: JSON.stringify([builder.entry]),
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
      CONNECTIONS: connections,
      EXAMPLE_CLIENT_SECRET: clientSecret,
    });
    closing.push(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', {
      key: builder.key,
      body: { playbook: 'alpha', name: 'Alpha' },
    });

    const echoed = await server.call('POST', `${alpha}/tool-servers/graph/tools/echo/execute`, {
      key: builder.key,
      body: { arguments: { said: `the secret is ${clientSecret}` } },
    });

    const { page, wholes } = await callEventsOf(server);
    const scrubbed = { said: 'the secret is [redacted]' };

    expect(echoed).toMatchObject({ status: 200, body: { outcome: 'result', text: JSON.stringify(scrubbed) } });
    expect(wholes.map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
    expect(wholes[0]?.data['arguments']).toEqual(scrubbed);
    expect(wholes[1]?.data['result']).toMatchObject({ content: [{ type: 'text', text: JSON.stringify(scrubbed) }] });
    expect(JSON.stringify([echoed.body, page, wholes])).not.toContain(clientSecret);
    expect(graph.received()).toMatchObject([{ tool: 'echo' }]);
  });
});
