import { plainTextIn, toolNamesIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  addressesOn,
  admin,
  commentKeys,
  commentOf,
  commentedPlaybook,
  commentsOf,
  type CommentedPlaybook,
} from './commented-playbook.ts';

let server: ReasoningServer;

let commented: CommentedPlaybook;

beforeEach(async () => {
  server = await servingReasoning([], commentKeys);
  commented = await commentedPlaybook(server);
});

afterEach(async () => {
  await server.stop();
});

function onMcp<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}${path}`, headers: { authorization: `Bearer ${admin.key}` } },
    use,
  );
}

async function made(address: string) {
  const { ofTheReader } = commented;
  return commentOf(
    (await ofTheReader.call('POST', `${ofTheReader.playbook}/comments`, { address, text: 'Fix it.' })).body,
  );
}

describe('the comment tools over MCP', () => {
  it('are list_comments and resolve_comment on /mcp and on the playbook endpoint, and no tool makes a comment', async () => {
    const named = await Promise.all(
      ['/mcp', '/orgs/acme/playbooks/alpha/mcp', '/orgs/acme/mcp'].map((path) =>
        onMcp(path, async (session) =>
          toolNamesIn(await session.listTools()).filter((name) => name.includes('comment')),
        ),
      ),
    );

    expect(named).toEqual([['list_comments', 'resolve_comment'], ['list_comments', 'resolve_comment'], []]);
  });

  it('let an agent read the open comments of a playbook and resolve one it acted on', async () => {
    const addresses = addressesOn(commented);
    const onTheStep = await made(addresses.step);
    await made(addresses.run);

    const { listed, resolved, after } = await onMcp('/mcp', async (session) => ({
      listed: await session.callTool('list_comments', { playbook: 'alpha' }),
      resolved: await session.callTool('resolve_comment', { playbook: 'alpha', id: onTheStep.id, how: 'acted' }),
      after: await session.callTool('list_comments', { playbook: 'alpha', address: addresses.step }),
    }));

    expect(commentsOf(listed.structuredContent).comments.map(({ address }) => address)).toEqual([
      addresses.run,
      addresses.step,
    ]);
    expect(commentOf(resolved.structuredContent)).toMatchObject({ open: false, resolved_how: 'acted' });
    expect(commentsOf(after.structuredContent).comments).toEqual([]);
  });

  it('let an agent on the playbook endpoint read the comments under a run', async () => {
    const addresses = addressesOn(commented);
    await made(addresses.event);
    await made(addresses.request);

    const listed = await onMcp('/orgs/acme/playbooks/alpha/mcp', (session) =>
      session.callTool('list_comments', { address: addresses.run, under: true }),
    );

    expect(commentsOf(listed.structuredContent).comments.map(({ address }) => address)).toEqual([addresses.event]);
  });
});

describe('the comment tools over MCP, in a retired playbook', () => {
  it('tell an agent that resolves a comment of a retired playbook that its comments can only be read', async () => {
    const { ofTheAdmin } = commented;
    const { id } = await made(addressesOn(commented).playbook);
    await ofTheAdmin.call('POST', '/v1/orgs/acme/playbooks/alpha/retire');

    const refused = await onMcp('/mcp', (session) =>
      session.callTool('resolve_comment', { playbook: 'alpha', id, how: 'acted' }),
    );

    expect([refused.isError, plainTextIn(refused)]).toEqual([
      true,
      'Could not resolve the comment: its playbook has been retired, so its comments can only be read. Nothing was changed. list_comments still reads them, open and resolved.',
    ]);
  });
});
