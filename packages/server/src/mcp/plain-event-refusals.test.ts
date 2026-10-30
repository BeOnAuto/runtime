import { plainTextIn, withMcpSession, type ToolResult } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

const won = { source: '/crm', type: 'com.acme.deal.won', id: 'deal-1' };

async function refusalsOfPublishing(): Promise<readonly ToolResult[]> {
  server = await servingReasoning([]);
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, async (session) => {
    const publishing = (event: Readonly<Record<string, unknown>>) =>
      session.callTool('publish_event', { playbook: 'sales', event });
    await session.callTool('create_playbook', { playbook: 'sales', name: 'Sales' });
    await publishing(won);
    return [
      await publishing({ source: '/runs/1', type: 'run_succeeded' }),
      await publishing({ ...won, data: 'lost' }),
      await publishing({ ...won, id: 'deal-2', data: 'x'.repeat(250_000) }),
    ];
  });
}

describe('the refusals of publish_event over MCP', () => {
  it('lead with plain words that name no internal term and say whether the caller can put it right', async () => {
    const refused = await refusalsOfPublishing();
    const words = refused.map((result) => plainTextIn(result));

    expect(refused.map(({ isError }) => isError)).toEqual([true, true, true]);
    expect(words.flatMap((plain) => internalTermsIn(plain))).toEqual([]);
    expect(words).toEqual([
      'Could not publish an event to the playbook: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
      'Could not publish the event “com.acme.deal.won” to the playbook: it clashes with something already there. Nothing was changed. The details below say what is in the way.',
      'Could not publish the event “com.acme.deal.won” to the playbook: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
    ]);
  });
});
