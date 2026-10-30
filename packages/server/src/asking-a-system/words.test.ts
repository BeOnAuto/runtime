import { plainTextIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { chatKey } from '../testing/interaction-servers/chat-deliveries.ts';
import {
  askingASystem,
  calling,
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
    const ran = await session.callTool('run_definition', { type: 'interaction', name, input, run_id: systemRunId });
    const read = await session.callTool('get_run', { run_id: systemRunId });
    return { ran: plainTextIn(ran), read: plainTextIn(read) };
  });
}

describe('the words of a run that asks a system, over MCP', () => {
  it('say what the tool answered, naming the tool in words', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');

    expect((await saidOf(server, 'thread-replies', threadInput)).ran).toBe(
      'Ran the interaction function “thread-replies”. It asked the thread tool of chat; its answer: (user: “member-17”, text: “Shipped the fix to staging.”, and ts: “1728380000.000100”) and (user: “member-42”, text: “Thanks, closing the ticket.”, and ts: “1728380100.000200”).',
    );
  });

  it('say why a run whose tool may have changed something did not go through, whole, with the longest name', async () => {
    const server = await askingASystem({ hints: { denied: { readOnlyHint: false } } });
    await server.define(longestName, calling('denied'));

    const { ran, read } = await saidOf(server, longestName);

    expect(read).toBe(
      `The run of the interaction function “${longestName}” did not go through: it could not finish after calling a tool that may change something, so whether that happened is not known, because the tool answered an error, which the details below give. It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.`,
    );
    expect(ran).toBe(
      `Could not run the interaction function “${longestName}”: it could not finish after calling a tool that may change something, so whether that happened is not known, because the tool answered an error, which the details below give. It is not run again by itself: a person decides, or a workflow rule that names this kind; its history shows the call.`,
    );
    expect([read.length, ran.length]).toEqual([397, 381]);
  });
});

describe('the words of a run that asks a system, kept plain', () => {
  it('name no internal term, and an output carries no secret of the server', async () => {
    const server = await askingASystem({ hints: { denied: { readOnlyHint: false } } });
    await server.define('thread-replies');
    await server.define('denying', calling('denied'));
    await server.define('echoing', { ...calling('echo', ["    said: '{{ input.said }}'"]), read: '/said' });
    const said = await saidOf(server, 'thread-replies', threadInput);
    const refused = await onAlpha(server, (session) =>
      session.callTool('run_definition', { type: 'interaction', name: 'denying', input: {} }),
    );
    const echoed = await server.runCall(
      'echoing',
      { said: `the key ${chatKey}` },
      '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c',
    );
    const summaries = (await server.history(systemRunId)).map(({ summary }) => summary);

    expect(
      [said.ran, said.read, plainTextIn(refused), ...summaries].flatMap((words) => internalTermsIn(words)),
    ).toEqual([]);
    expect(echoed.body).toMatchObject({ output: 'the key [redacted]' });
    expect(echoed.text).not.toContain(chatKey);
  });

  it('say that running again is safe for a run whose tools only read, and that nothing was changed', async () => {
    const server = await askingASystem();
    await server.define(longestName, calling('denied'));

    const { ran, read } = await saidOf(server, longestName);

    expect(ran).toBe(
      `Could not run the interaction function “${longestName}”: it called tools but could not finish, because the tool answered an error, which the details below give. Nothing was changed. Every tool it called only reads, by its server's own account, so running it again is safe: a new run, or a workflow's retry, may make it; its history shows what it called.`,
    );
    expect([read.length, ran.length]).toEqual([382, 387]);
  });
});
