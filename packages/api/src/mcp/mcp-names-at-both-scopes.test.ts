import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession, type McpSession } from '../testing/mcp-clients.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { listedTools, toolNamesIn, type ListedTool } from '../testing/tool-listing.ts';

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [...notebookOperations, listNotesOfTheOrg] });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function onMcp<T>(path: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    use,
  );
}

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return onMcp(path, async (session) => listedTools(await session.listTools()));
}

function listNotesIn(tools: readonly ListedTool[]): ListedTool | undefined {
  return tools.find(({ name }) => name === 'list_notes');
}

describe('a name used by an org operation and a playbook operation', () => {
  it('is one tool on /mcp, the org operation, whose playbook is its own and optional, and each operation on its endpoint', async () => {
    const [own, org, playbook] = await Promise.all([
      listingOn('/mcp'),
      listingOn('/orgs/acme/mcp'),
      listingOn('/orgs/acme/playbooks/alpha/mcp'),
    ]);

    expect(toolNamesIn({ tools: own }).filter((name) => name === 'list_notes')).toHaveLength(1);
    expect(listNotesIn(own)).toEqual(listNotesIn(org));
    expect(listNotesIn(own)?.inputSchema).toMatchObject({ properties: { playbook: { type: 'string' } } });
    expect(listNotesIn(own)?.inputSchema['required']).toBeUndefined();
    expect(listNotesIn(playbook)?.description).toBe(
      notebookOperations.find(({ registration }) => registration.name === 'list_notes')?.registration.description,
    );
  });

  it('answers on /mcp for the org without a playbook, and for the playbook it is given', async () => {
    const answered = await onMcp('/mcp', async (session) => ({
      inOrg: await session.callTool('list_notes', {}),
      inPlaybook: await session.callTool('list_notes', { playbook: 'beta' }),
    }));

    expect([answered.inOrg.structuredContent, answered.inPlaybook.structuredContent]).toEqual([
      { kept_for: 'the org' },
      { kept_for: 'beta' },
    ]);
  });
});
