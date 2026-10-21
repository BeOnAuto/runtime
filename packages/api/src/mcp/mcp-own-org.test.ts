import { authenticatorFor } from '@on.auto/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { mcpClientKinds, plainTextIn, problemIn, withMcpSession, type McpSession } from '../testing/mcp-clients.ts';
import { initializeAt, messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import {
  acmeAdmin,
  acmeAlphaWriter,
  acmeReader,
  globexAdmin,
  operationServer,
  type OperationServer,
} from '../testing/operation-server.ts';
import { danglingReferencesIn } from '../testing/self-contained.ts';
import { guideToolName, listedTools, takingPlaybook, toolNamesIn, type ListedTool } from '../testing/tool-listing.ts';
import { instructionsFor } from './instructions.ts';

const orgTools = ['label_playbook', 'list_labels'];

const playbookTools = [
  'add_note',
  'check_lines',
  'list_notes',
  'get_note',
  'latest_note',
  'break_down',
  'wait_forever',
  'send_notes',
];

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

function asKey<T>(key: string, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => listedTools(await session.listTools()),
  );
}

const followingTheNoteRecipe = ' It holds the recipe take-a-note, which the tools listed here can follow.';

describe('the tools of /mcp', () => {
  it('are the tools of the org endpoint as they are, then those of a playbook endpoint taking a playbook, and get_guide as the playbook endpoint lists it', async () => {
    const [own, org, playbook] = await Promise.all([
      listingOn('/mcp'),
      listingOn('/orgs/acme/mcp'),
      listingOn('/orgs/acme/playbooks/alpha/mcp'),
    ]);

    const guide = own.find(({ name }) => name === guideToolName);

    expect(own.map(({ name }) => name)).toEqual([...orgTools, ...playbookTools, guideToolName]);
    expect(own).toEqual([
      ...org.filter(({ name }) => name !== guideToolName),
      ...playbook.filter(({ name }) => name !== guideToolName).map((tool) => takingPlaybook(tool)),
      guide,
    ]);
    expect(guide?.description).toContain(followingTheNoteRecipe);
    expect([org.at(-1), playbook.at(-1)]).toEqual([
      { ...guide, description: guide?.description?.replace(followingTheNoteRecipe, '') },
      guide,
    ]);
  });

  it('have self-contained input schemas with an object root, and no output schema', async () => {
    const tools = listedTools(await asKey(acmeAdmin.key, (session) => session.listTools()));
    const schemas = tools.map(({ inputSchema }) => inputSchema);

    expect(schemas.map((schema) => schema['type'])).toEqual(schemas.map(() => 'object'));
    expect(schemas.flatMap((schema) => danglingReferencesIn(schema))).toEqual([]);
    expect(tools.filter(({ outputSchema }) => outputSchema !== undefined)).toEqual([]);
  });

  it("carry the instructions of the caller's own org", async () => {
    const instructions = await asKey(acmeAdmin.key, (session) => Promise.resolve(session.instructions));

    expect(instructions).toBe(
      instructionsFor('own org', { orgTools, playbookTools }, [{ type: 'notes', noun: 'note', guide: 'notebook' }]),
    );
    expect(instructions).toContain("This connection acts in the caller's own org.");
  });
});

describe('a playbook tool on /mcp', () => {
  it('acts in the playbook its argument names, in the org of the key', async () => {
    const outcome = await asKey(acmeAdmin.key, async (session) => ({
      added: await session.callTool('add_note', { playbook: 'beta', name: 'own-org', text: 'hi' }),
      read: await session.callTool('get_note', { playbook: 'beta', name: 'own-org' }),
      elsewhere: await session.callTool('get_note', { playbook: 'alpha', name: 'own-org' }),
    }));

    expect(outcome.added.structuredContent).toEqual({ name: 'own-org', text: 'hi' });
    expect(outcome.read.structuredContent).toEqual({ name: 'own-org', text: 'hi' });
    expect(problemIn(outcome.elsewhere)).toMatchObject({ reason: 'not_found', detail: 'There is no note own-org' });
  });

  it('answers an operation whose input has no field, given only the playbook, with its result and its plain words', async () => {
    const latest = await asKey(acmeAdmin.key, async (session) => {
      await session.callTool('add_note', { playbook: 'beta', name: 'latest', text: 'the last note' });
      return session.callTool('latest_note', { playbook: 'beta' });
    });

    expect(latest.isError).toBeUndefined();
    expect(latest.structuredContent).toEqual({ name: 'latest', text: 'the last note' });
    expect(plainTextIn(latest)).toBe('The latest note is “latest”.');
  });

  it('answers a call without a playbook with invalid_input pointing at /playbook', async () => {
    const result = await asKey(acmeAdmin.key, (session) => session.callTool('list_notes', {}));

    expect({ isError: result.isError, problem: problemIn(result) }).toMatchObject({
      isError: true,
      problem: { reason: 'invalid_input', errors: [{ detail: 'Missing key', pointer: '/playbook' }] },
    });
  });

  it('answers a playbook the org does not have with not_found', async () => {
    const result = await asKey(acmeAdmin.key, (session) => session.callTool('list_notes', { playbook: 'nowhere' }));

    expect(problemIn(result)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no playbook nowhere in this org',
    });
  });
});

describe('the callers of /mcp', () => {
  it('reach only the playbooks of their own org, whatever the arguments name', async () => {
    const outcome = await asKey(globexAdmin.key, async (session) => ({
      named: await session.callTool('list_notes', { playbook: 'alpha' }),
      withOrg: await session.callTool('list_notes', { playbook: 'alpha', org: 'acme' }),
      own: await session.callTool('list_notes', { playbook: 'gamma' }),
    }));

    expect(problemIn(outcome.named)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no playbook alpha in this org',
    });
    expect(problemIn(outcome.withOrg)).toMatchObject({ reason: 'not_found' });
    expect(outcome.own.structuredContent).toEqual({ notes: [] });
  });

  it('are refused a playbook outside their key, and are offered no command their key does not permit', async () => {
    const limited = await asKey(acmeAlphaWriter.key, (session) => session.callTool('list_notes', { playbook: 'beta' }));
    const offered = await asKey(acmeReader.key, async (session) => toolNamesIn(await session.listTools()));

    expect(problemIn(limited)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may not access this playbook',
    });
    expect(offered).toEqual([
      'list_labels',
      'list_notes',
      'get_note',
      'latest_note',
      'break_down',
      'wait_forever',
      guideToolName,
    ]);
    await expect(
      asKey(acmeReader.key, (session) =>
        session.callTool('add_note', { playbook: 'alpha', name: 'read-only', text: 'no' }),
      ),
    ).rejects.toThrow('Tool add_note not found');
  });
});

describe('the org of /mcp without a key', () => {
  it('is local in local mode, where no key names an org', async () => {
    const local = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });
    const onLocalhost = { host: 'localhost:5555' };

    const labelled = await postMcp(
      local.handler,
      '/mcp',
      { ...onLocalhost, 'mcp-protocol-version': '2025-11-25' },
      requestOf(1, 'tools/call', { name: 'label_playbook', arguments: { playbook: 'alpha', label: 'mine' } }),
    );
    const labels = await call(local.handler, '/v1/orgs/local/playbook-labels', { headers: onLocalhost });

    expect(messagesIn(labelled)).toMatchObject([
      { result: { structuredContent: { playbook: 'alpha', label: 'mine' } } },
    ]);
    expect(labels.body).toEqual({ labels: [{ playbook: 'alpha', label: 'mine' }] });
  });

  it('answers a request without a key with a 401 challenge, and GET with 405 and Allow: POST', async () => {
    const unauthenticated = await postMcp(server.handler, '/mcp', {});
    const get = await call(server.handler, '/mcp', { headers: { authorization: `Bearer ${acmeAdmin.key}` } });

    expect({ status: unauthenticated.status, challenge: unauthenticated.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: 'Bearer',
    });
    expect({ status: get.status, allow: get.headers.get('allow') }).toEqual({ status: 405, allow: 'POST' });
  });
});

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists every tool and calls a playbook tool', async () => {
    const outcome = await withMcpSession(
      kind,
      { url: `${listening.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
      async (session) => ({
        tools: listedTools(await session.listTools()).map(({ name }) => name),
        notes: await session.callTool('list_notes', { playbook: 'alpha' }),
      }),
    );

    expect(outcome.tools).toEqual([...orgTools, ...playbookTools, guideToolName]);
    expect(outcome.notes.isError).toBeUndefined();
  });
});

describe('the revisions of /mcp', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])(
    'answers an initialize in %s in that revision',
    async (revision) => {
      const answer = await postMcp(
        server.handler,
        '/mcp',
        { authorization: `Bearer ${acmeAdmin.key}` },
        initializeAt(revision),
      );

      expect(messagesIn(answer)).toMatchObject([{ result: { protocolVersion: revision } }]);
    },
  );
});
