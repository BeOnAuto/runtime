import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([], { API_KEYS: JSON.stringify([acmeAdmin.entry]) });
});

afterAll(async () => {
  await server.stop();
});

const ResourcesSchema = Schema.Struct({
  resources: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })),
});

function guidesOnTheShelf(): Promise<readonly { readonly name: string; readonly title: string }[]> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => Schema.decodeUnknownSync(ResourcesSchema)(await session.listResources()).resources,
  );
}

describe('the API catalog of the server', () => {
  it('is answered without a key, linking the document, each guide of the shelf in its order and the health', async () => {
    const [answer, operation, guides] = await Promise.all([
      fetch(`${server.origin}/.well-known/api-catalog`),
      fetch(`${server.origin}/v1/orgs/acme/playbooks`),
      guidesOnTheShelf(),
    ]);
    const catalog: unknown = await answer.json();

    expect([answer.status, operation.status]).toEqual([200, 401]);
    expect(answer.headers.get('link')).toBe(`<${server.origin}/.well-known/api-catalog>; rel="api-catalog"`);
    expect(guides.length).toBeGreaterThan(0);
    expect(catalog).toEqual({
      linkset: [
        { anchor: `${server.origin}/.well-known/api-catalog`, item: [{ href: `${server.origin}/v1` }] },
        {
          anchor: `${server.origin}/v1`,
          'service-desc': [{ href: `${server.origin}/v1/openapi.json`, type: 'application/json' }],
          'service-doc': guides.map(({ name, title }) => ({
            href: `${server.origin}/v1/guides/${name}`,
            type: 'text/markdown',
            title,
          })),
          status: [{ href: `${server.origin}/health` }],
        },
      ],
    });
  });
});
