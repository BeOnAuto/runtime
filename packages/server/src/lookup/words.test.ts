import { plainTextIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import {
  calling,
  lookingUp,
  systemRunId,
  threadInput,
  type SystemServer,
} from '../testing/interaction-servers/system-calls.ts';

const longestName = `thread-${'x'.repeat(41)}`;

function onAlpha<T>(server: SystemServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

function saidOf(server: SystemServer, name: string, input: unknown = {}) {
  return onAlpha(server, async (session) => {
    const ran = await session.callTool('run_definition', { type: 'lookup', name, input, run_id: systemRunId });
    const read = await session.callTool('get_run', { run_id: systemRunId });
    return { ran: plainTextIn(ran), read: plainTextIn(read) };
  });
}

describe('the words of a run of a lookup function, over MCP', () => {
  it('say what the tool answered, naming the tool in words', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');

    expect((await saidOf(server, 'thread-replies', threadInput)).ran).toMatch(
      /^Ran the lookup function “thread-replies”\. It asked the thread tool of chat; its answer: \(user: “member-17”, text: “Shipped the fix to staging\.”, and ts: “1728380000\.000100”\) and \(user: “member-42”/u,
    );
  });

  it('say that running again is safe for a run whose tool only reads, and that nothing was changed, with the longest name', async () => {
    const server = await lookingUp();
    await server.define(longestName, calling('denied'));

    const { ran, read } = await saidOf(server, longestName);

    expect(ran).toBe(
      `Could not run the lookup function “${longestName}”: it called tools but could not finish, because the tool answered an error, which the details below give. Nothing was changed. Every tool it called is marked reads, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.`,
    );
    expect([read.length, ran.length]).toEqual([353, 358]);
  });

  it('say why a run whose tool is no longer marked reads did not go through', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    server.fake.annotateTool('thread', { readOnlyHint: false });

    const { ran } = await saidOf(server, 'thread-replies', threadInput);

    expect(ran).toBe(
      'Could not run the lookup function “thread-replies”: the tool it reads through is no longer marked reads, so it was not called. Nothing was changed. Once the tool is marked reads again, it can be tried again; a tool that may change something belongs to an interaction function.',
    );
  });
});

describe('the words of a run of a lookup function, kept plain', () => {
  it('name no internal term in what it said, read or recorded', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    const said = await saidOf(server, 'thread-replies', threadInput);
    const summaries = (await server.history(systemRunId)).map(({ summary }) => summary);

    expect([said.ran, said.read, ...summaries].flatMap((words) => internalTermsIn(words))).toEqual([]);
  });
});
