import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { lookupDocument } from '@on.auto/lookup/testing';
import { threadReplies } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { lookingUp, systemRunId, threadInput } from '../testing/interaction-servers/system-calls.ts';

const thread = 'thread-replies';

describe('a lookup function over MCP', () => {
  it('is created, run and its run read on the endpoint of its playbook', async () => {
    const server = await lookingUp();

    const said = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => {
        const created = await session.callTool('create_definition', {
          type: 'lookup',
          name: thread,
          source: lookupDocument(),
          diagram: 'none',
        });
        const ran = await session.callTool('run_definition', {
          type: 'lookup',
          name: thread,
          input: threadInput,
          run_id: systemRunId,
        });
        const read = await session.callTool('get_run', { run_id: systemRunId });
        return { created, ran, read };
      },
    );

    expect(said.created.structuredContent).toMatchObject({ type: 'lookup', name: thread, version: 1 });
    expect(said.ran.structuredContent).toMatchObject({ type: 'lookup', status: 'succeeded', output: threadReplies });
    expect(said.read.structuredContent).toMatchObject({
      run_id: systemRunId,
      type: 'lookup',
      name: thread,
      status: 'succeeded',
      record: { server: 'chat', tool: 'thread', read: '/messages' },
    });
    expect(plainTextIn(said.created)).toContain('lookup function');
    expect(server.fake.received()).toHaveLength(1);
  });
});
