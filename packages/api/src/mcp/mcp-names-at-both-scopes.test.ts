import { defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession, type McpSession } from '../testing/mcp-clients.ts';
import { NoteSchema, listNotesOfTheOrg, notebookOperations, plainly } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { listedTools, toolNamesIn, type ListedTool } from '../testing/tool-listing.ts';

const getNoteOfTheOrg = defineQuery('org', {
  name: 'get_note',
  title: 'Get note',
  description:
    "Reads one note: with `playbook`, of that playbook, and without it, of the org's own. Use it when the note is named. `name` names it.",
  route: { method: 'GET', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ name: NoteSchema.fields.name }),
  outputSchema: NoteSchema,
  reasons: ['not_found'],
  handle: ({ name }) => Effect.succeed({ name, text: 'kept by the org' }),
  plainLanguage: plainly('read the note'),
});

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({ operations: [...notebookOperations, listNotesOfTheOrg, getNoteOfTheOrg] });
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

function getNoteIn(tools: readonly ListedTool[]): ListedTool | undefined {
  return tools.find(({ name }) => name === 'get_note');
}

describe('a name used by a playbook operation and an org operation that takes no playbook', () => {
  it('is one tool on /mcp and on the org endpoint, the org operation with an optional playbook, and the playbook operation on its endpoint', async () => {
    const [own, org, playbook] = await Promise.all([
      listingOn('/mcp'),
      listingOn('/orgs/acme/mcp'),
      listingOn('/orgs/acme/playbooks/alpha/mcp'),
    ]);

    expect(toolNamesIn({ tools: own }).filter((name) => name === 'get_note')).toHaveLength(1);
    expect(getNoteIn(own)).toEqual(getNoteIn(org));
    expect(getNoteIn(own)?.description).toBe(getNoteOfTheOrg.registration.description);
    expect(getNoteIn(own)?.inputSchema).toMatchObject({
      properties: { playbook: { type: 'string' }, name: { type: 'string' } },
      required: ['name'],
    });
    expect(getNoteIn(playbook)?.inputSchema['properties']).not.toHaveProperty('playbook');
  });

  it("answers for the playbook a call names, and for the org's own without one, on /mcp and on the org endpoint", async () => {
    const onOwn = await onMcp('/mcp', async (session) => {
      await session.callTool('add_note', { playbook: 'alpha', name: 'kept', text: 'in alpha' });
      return {
        inPlaybook: await session.callTool('get_note', { playbook: 'alpha', name: 'kept' }),
        inOrg: await session.callTool('get_note', { name: 'kept' }),
        refused: await session.callTool('get_note', { playbook: 'Not A Playbook', name: 'kept' }),
      };
    });
    const onOrg = await onMcp('/orgs/acme/mcp', async (session) => ({
      inPlaybook: await session.callTool('get_note', { playbook: 'alpha', name: 'kept' }),
      inOrg: await session.callTool('get_note', { name: 'kept' }),
    }));

    expect(
      [onOwn.inPlaybook, onOwn.inOrg, onOrg.inPlaybook, onOrg.inOrg].map(({ structuredContent }) => structuredContent),
    ).toEqual([
      { name: 'kept', text: 'in alpha' },
      { name: 'kept', text: 'kept by the org' },
      { name: 'kept', text: 'in alpha' },
      { name: 'kept', text: 'kept by the org' },
    ]);
    expect(onOwn.refused.isError).toBe(true);
  });
});
