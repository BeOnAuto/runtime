import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { problemIn, withMcpSession, type McpConnection, type ToolResult } from '../testing/mcp-clients.ts';
import { acmeAlphaWriter, acmeReader, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { guideToolName, listedTools, toolNamesIn } from '../testing/tool-listing.ts';

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer();
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function endpoint(path: string, key: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function problemOf(result: ToolResult): unknown {
  return { isError: result.isError, problem: problemIn(result) };
}

describe('the permissions of the caller of a tool', () => {
  it('list for a read-only key the queries and no command, in instructions that name no command', async () => {
    const outcome = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/playbooks/alpha/mcp', acmeReader.key),
      async (session) => ({
        tools: toolNamesIn(await session.listTools()),
        instructions: String(session.instructions),
        query: await session.callTool('list_notes'),
      }),
    );

    expect(outcome.tools).toEqual([
      'list_notes',
      'get_note',
      'latest_note',
      'break_down',
      'wait_forever',
      guideToolName,
    ]);
    expect(['add_note', 'check_lines', 'send_notes'].filter((name) => outcome.instructions.includes(name))).toEqual([]);
    expect(outcome.query.isError).toBeUndefined();
  });
});

describe('a command a read-only key is not offered', () => {
  it('is answered as a tool the endpoint does not list', async () => {
    await expect(
      withMcpSession('current revision', endpoint('/orgs/acme/playbooks/alpha/mcp', acmeReader.key), (session) =>
        session.callTool('add_note', { name: 'read-only', text: 'no' }),
      ),
    ).rejects.toThrow('Tool add_note not found');
  });
});

describe('the playbooks of the caller of a tool', () => {
  it('let a key limited to some playbooks call the tools of a playbook it may access', async () => {
    const added = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/playbooks/alpha/mcp', acmeAlphaWriter.key),
      (session) => session.callTool('add_note', { name: 'limited', text: 'yes' }),
    );

    expect(added.structuredContent).toEqual({ name: 'limited', text: 'yes' });
  });

  it('confine an org tool of a key limited to some playbooks to those playbooks', async () => {
    const labelled = await withMcpSession(
      'previous revision',
      endpoint('/orgs/acme/mcp', acmeAlphaWriter.key),
      async (session) => ({
        own: await session.callTool('label_playbook', { playbook: 'alpha', label: 'a' }),
        other: await session.callTool('label_playbook', { playbook: 'beta', label: 'b' }),
      }),
    );

    expect(labelled.own.structuredContent).toEqual({ playbook: 'alpha', label: 'a' });
    expect(problemOf(labelled.other)).toMatchObject({ isError: true, problem: { reason: 'forbidden' } });
  });
});

describe('the playbook endpoint of a playbook that does not exist', () => {
  it('lists the playbook tools and answers a call with a not_found problem', async () => {
    const outcome = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/playbooks/nowhere/mcp', acmeReader.key),
      async (session) => ({
        tools: listedTools(await session.listTools()).length,
        called: await session.callTool('list_notes'),
      }),
    );

    expect(outcome.tools).toBeGreaterThan(0);
    expect(problemOf(outcome.called)).toEqual({
      isError: true,
      problem: {
        type: 'https://on.auto/problems/not_found',
        title: 'Not found',
        status: 404,
        detail: 'There is no playbook nowhere in this org',
        reason: 'not_found',
      },
    });
  });
});
