import { callDocument } from '@on.auto/interaction/testing';
import { serveFakeApi } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import { openInput, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const apiKey = 'billing-api-key-5c2e8d1f';

const nameOutput: readonly string[] = ['output:', '  schema: { type: string }'];

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) })),
  }),
);

async function askingAnApi() {
  const billing = await serveFakeApi({ key: apiKey, requestIdHeader: 'x-request-id' });
  onTestFinished(billing.close);
  const entry = { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: 'acme' };
  const server = await interactionServerOn({
    BILLING_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({ billing: { ...entry, request_id: 'x-request-id' } }),
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = callDocument({
    server: 'billing',
    tool: 'get_profiles_id',
    with: ["    id: '{{ input.id }}'"],
    read: '/name',
    input: openInput,
    output: nameOutput,
  });
  await server.call('POST', `${alpha}/definitions/interaction`, { body: { name: 'profile-name', source } });
  return { billing, server };
}

describe('an interaction function that asks a system through an HTTP API', () => {
  it('calls the operation once with the key of its entry, answers what it read, and records the call', async () => {
    const { billing, server } = await askingAnApi();

    const ran = await server.call('POST', `${alpha}/definitions/interaction/profile-name/run`, {
      body: { input: { id: 'ada' }, run_id: systemRunId },
    });
    const { events } = decodeHistory((await server.call('GET', `${alpha}/runs/${systemRunId}/history`)).body);

    expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: 'Ada' } });
    expect(billing.seen()).toMatchObject([
      { method: 'GET', path: '/v1/profiles/ada', query: '', headers: { 'x-api-key': apiKey } },
    ]);
    expect(events.map(({ type }) => type)).toEqual([
      'run_started',
      'tool_call_started',
      'tool_call_answered',
      'run_succeeded',
    ]);
    expect(events[1]?.data).toMatchObject({ server: 'billing', tool: 'get_profiles_id' });
    expect(events[2]?.data).toMatchObject({ jsonrpc_id: null, server_request_id: 'request-1' });
  });
});
