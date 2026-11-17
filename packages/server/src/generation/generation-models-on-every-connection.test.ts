import { toolNamesIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const acmePlaybookReader = createApiKey({
  id: 'acme-playbook-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: '*',
});

const acmeOrgReader = createApiKey({ id: 'acme-org-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const acmeBetaReader = createApiKey({
  id: 'acme-beta-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: ['beta'],
});

const listed = 'list_generation_models';

const connections = ['/mcp', '/orgs/acme/mcp', '/orgs/acme/playbooks/alpha/mcp'];

const playbookEndpoint = '/orgs/acme/playbooks/alpha/mcp';

const everyFieldListedOf = Schema.decodeUnknownSync(
  Schema.Struct({
    tools: Schema.Array(
      Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]),
    ),
  }),
);

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([], {
    API_KEYS: JSON.stringify([acmeAdmin.entry, acmePlaybookReader.entry, acmeOrgReader.entry, acmeBetaReader.entry]),
    MODEL_GATEWAYS: JSON.stringify([{ name: 'images', base_url: 'http://127.0.0.1:9/v1', api_key: 'never-asked' }]),
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: acmeAdmin.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: acmeAdmin.key,
    body: { playbook: 'beta', name: 'Beta' },
  });
});

afterEach(async () => {
  await server.stop();
});

function onMcpAs<T>(path: string, key: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

function namesListedOn(path: string, key: string): Promise<readonly string[]> {
  return onMcpAs(path, key, async (session) => toolNamesIn(await session.listTools()));
}

const imageModels = [
  'openai/gpt-image-2',
  'openai/gpt-image-2.6-flare',
  'openai/gpt-image-2.6-sunburst',
  'vertex_ai/gemini-3-pro-image',
  'vertex_ai/gemini-nano-banana-2.1',
  'xai/grok-imagine-image-2.0',
];

describe('list_generation_models on the endpoint of one playbook', () => {
  it('is listed as on /mcp and the org endpoint, with the same title, description, hints and arguments, none of them a playbook, and answers the same', async () => {
    const tools = await Promise.all(
      connections.map((path) =>
        onMcpAs(path, acmeAdmin.key, async (session) =>
          JSON.stringify(everyFieldListedOf(await session.listTools()).tools.find(({ name }) => name === listed)),
        ),
      ),
    );
    const answers = await Promise.all(
      connections.map((path) =>
        onMcpAs(path, acmeAdmin.key, async (session) =>
          JSON.stringify((await session.callTool(listed, { kind: 'image' })).structuredContent),
        ),
      ),
    );
    const inThePlaybook = await onMcpAs(playbookEndpoint, acmeAdmin.key, (session) =>
      session.callTool(listed, { kind: 'image' }),
    );

    expect(tools).toEqual(connections.map(() => tools[0]));
    expect(tools[0]).not.toContain('"playbook"');
    expect(answers).toEqual(connections.map(() => answers[0]));
    expect(inThePlaybook.structuredContent).toMatchObject({
      object: 'list',
      gateways: ['images'],
      data: imageModels.map((model) => ({ model })),
    });
  });

  it('is offered to a key that may read the playbook, which it answers, and to no key that may not, which it does not know', async () => {
    const reading = await onMcpAs(playbookEndpoint, acmePlaybookReader.key, async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      answer: await session.callTool(listed, {}),
    }));
    const notReading = await namesListedOn(playbookEndpoint, acmeOrgReader.key);
    const refused = await onMcpAs(playbookEndpoint, acmeOrgReader.key, (session) => session.callTool(listed, {})).then(
      () => 'answered',
      String,
    );

    expect(reading.tools).toContain(listed);
    expect(reading.answer.isError).toBeUndefined();
    expect(notReading).not.toContain(listed);
    expect(refused).toContain(`Tool ${listed} not found`);
  });
});

describe('list_generation_models on /mcp and the org endpoint', () => {
  it('is offered by the permission to read the org, as before, and not by the permission to read a playbook alone', async () => {
    const offered = await Promise.all(
      ['/mcp', '/orgs/acme/mcp'].flatMap((path) =>
        [acmeOrgReader.key, acmePlaybookReader.key].map(async (key) =>
          (await namesListedOn(path, key)).includes(listed),
        ),
      ),
    );

    expect(offered).toEqual([true, false, true, false]);
  });
});

describe('list_generation_models of a playbook over HTTP', () => {
  it("answers what the org's route answers to a key that may read the playbook, and is refused to one that may not read it or may not reach it", async () => {
    const inThePlaybook = '/v1/orgs/acme/playbooks/alpha/generation-models';

    const [ofTheOrg, read, unpermitted, unreached] = await Promise.all([
      server.call('GET', '/v1/orgs/acme/generation-models', { key: acmeOrgReader.key }),
      server.call('GET', inThePlaybook, { key: acmePlaybookReader.key }),
      server.call('GET', inThePlaybook, { key: acmeOrgReader.key }),
      server.call('GET', inThePlaybook, { key: acmeBetaReader.key }),
    ]);

    expect(ofTheOrg.status).toBe(200);
    expect({ status: read.status, body: read.body }).toEqual({ status: 200, body: ofTheOrg.body });
    expect({ status: unpermitted.status, body: unpermitted.body }).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller lacks the playbook:read permission' },
    });
    expect({ status: unreached.status, body: unreached.body }).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller may not access this playbook' },
    });
  });
});
