import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import { servingWorkflows } from '../testing/servers/workflow-server.ts';

let server: Awaited<ReturnType<typeof servingWorkflows>>;

afterEach(async () => {
  await server.stop();
});

describe('the plain words for a connection that may not do what it asked, over MCP', () => {
  it('say plainly that a connection is not allowed to do what it asked', async () => {
    const limited = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, playbooks: ['alpha'] });
    server = await servingWorkflows([], { API_KEYS: JSON.stringify([limited.entry]) });

    const refused = await withMcpSession(
      'current revision',
      { url: `${server.origin}/mcp`, headers: { authorization: `Bearer ${limited.key}` } },
      (session) => session.callTool('list_definitions', { playbook: 'beta', type: 'reasoning' }),
    );

    expect(plainTextIn(refused)).toBe(
      'Could not list the reasoning functions: this connection is not allowed to do that. Whoever set up this connection can allow it.',
    );
  });
});
