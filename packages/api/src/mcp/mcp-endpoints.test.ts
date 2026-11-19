import { Client, ClientCredentialsProvider, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { authenticatorFor } from '@on.auto/identity';
import {
  type AccessDecision,
  CallPermission,
  callPermissionDecidedBy,
  defineCommand,
  defineQuery,
  DirectoryListing,
  makeCatalog,
  makeDispatcher,
  OperationsServed,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import { Context, Effect, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { guideShelfOf, mcpRoutes } from '../index.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { type Listening, listenOnLoopback } from '../testing/listening.ts';
import { type McpConnection, plainTextIn, problemIn, type ToolResult, withMcpSession } from '../testing/mcp-clients.ts';
import { jsonOf, postMcp } from '../testing/mcp-requests.ts';
import { notebookOperations } from '../testing/notebook.ts';
import {
  acmeAdmin,
  acmeAlphaWriter,
  acmeReader,
  globexAdmin,
  operationServer,
  type OperationServer,
  testRetryStateKeys,
  testServerInfo,
} from '../testing/operation-server.ts';
import { issuerOnLoopback, type OnLoopback, signedInOnLoopback } from '../testing/signed-in.ts';
import { guideToolName, listedTools, toolNamesIn } from '../testing/tool-listing.ts';

const anyWords: unknown = expect.any(String);

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const limit = requestBodyLimit;

function forbiddenProblem(detail: string): Readonly<Record<string, unknown>> {
  return { type: 'https://on.auto/problems/forbidden', title: 'Forbidden', status: 403, detail, reason: 'forbidden' };
}

function pingWithPadding(size: number): string {
  return JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1, padding: 'a'.repeat(size) });
}

function sdkError(message: string): Readonly<Record<string, unknown>> {
  return { jsonrpc: '2.0', error: { code: -32_000, message }, id: null };
}

const otherCallers: ReadonlyArray<readonly [string, string, string, string]> = [
  ['another org', '/orgs/globex/mcp', acmeAdmin.key, 'The caller does not belong to this org'],
  [
    'a playbook of another org',
    '/orgs/acme/playbooks/alpha/mcp',
    globexAdmin.key,
    'The caller does not belong to this org',
  ],
  [
    'a playbook outside the key',
    '/orgs/acme/playbooks/beta/mcp',
    acmeAlphaWriter.key,
    'The caller may not access this playbook',
  ],
];

const answering = {
  title: 'Listing',
  description: 'Answers whether the call came through the directory listing. Use it to see. It changes nothing.',
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ directory: Schema.Boolean }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    return { directory: yield* DirectoryListing };
  }),
  plainLanguage: {
    task: 'answer the listing',
    attempt: () => 'answer the listing',
    outcome: ({ directory }: { readonly directory: boolean }) => (directory ? 'In the listing.' : 'Outside it.'),
  },
};

const inTheOrg = defineQuery('org', { ...answering, name: 'org_listing', route: { method: 'GET', path: '/listing' } });

const inAPlaybook = defineCommand('playbook', {
  ...answering,
  name: 'playbook_listing',
  route: { method: 'POST', path: '/listing' },
});

let server: OperationServer;

let listening: Listening;

function calledAt(path: string) {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => ({
      tools: listedTools(await session.listTools()).map(({ name }) => name),
      inTheOrg: plainTextIn(await session.callTool('org_listing')),
      inAPlaybook: plainTextIn(await session.callTool('playbook_listing', { playbook: 'alpha' })),
    }),
  );
}

const sdkErrors: string[] = [];

const emptyShelf = guideShelfOf([], [], []);

const brokenRuntime = mcpRoutes({
  catalog: makeCatalog(notebookOperations),
  dispatcher: makeDispatcher([]),
  runCall: () => Promise.reject(new Error('the runtime broke while holding database password hunter2')),
  serverInfo: testServerInfo,
  retryStateKeys: testRetryStateKeys,
  shelf: emptyShelf,
  reportError: (error) => {
    sdkErrors.push(error.message);
  },
});

function endpoint(path: string, key: string): McpConnection {
  return { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function checkingLines(lines: string): Promise<ToolResult> {
  return withMcpSession('current revision', endpoint('/orgs/acme/playbooks/alpha/mcp', acmeAdmin.key), (session) =>
    session.callTool('check_lines', { lines }),
  );
}

function problemOf(result: ToolResult): unknown {
  return { isError: result.isError, problem: problemIn(result) };
}

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const queriesAlone: PolicyDecisionPoint = {
  decide: (request) => Effect.succeed(request.context.operation.kind === 'query' ? allowed : denied),
};

function listedOn(path: string): Promise<readonly string[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => toolNamesIn(await session.listTools()),
  );
}

const clients = {
  'ada-agent': { secret: 'a-secret-only-ada-holds', claims: { sub: 'ada', name: 'Ada Lovelace', org_id: 'acme' } },
};

const opened: OnLoopback<unknown>[] = [];

const takesNothing = Schema.Record(Schema.String, Schema.Never);

const keepNote = defineCommand('org', {
  name: 'keep_note',
  title: 'Keep note',
  description: 'Keeps a note of the org. Use it when the person writes one. It answers whether it kept it.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: takesNothing,
  outputSchema: Schema.Struct({ kept: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ kept: true }),
  plainLanguage: { task: 'keep a note', attempt: () => 'keep the note', outcome: () => 'Kept the note.' },
});

const keepsNotesBeside = defineQuery('playbook', {
  name: 'keeps_notes_beside',
  title: 'Keeps notes beside',
  description:
    'Says whether keep_note is served beside it. Use it to learn what the endpoint serves. It answers yes or no.',
  route: { method: 'GET', path: '/notes-beside' },
  inputSchema: takesNothing,
  outputSchema: Schema.Struct({ served: Schema.Boolean }),
  reasons: [],
  handle: () =>
    Effect.gen(function* () {
      const serves = yield* OperationsServed;
      return { served: serves('keep_note') };
    }),
  plainLanguage: { task: 'say what is served', attempt: () => 'say what is served', outcome: () => 'Said it.' },
});

async function servedOver(path: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
  const connection = { url: `${listening.origin}${path}`, headers: asAdmin };
  const answer = await withMcpSession('current revision', connection, (session) =>
    session.callTool('keeps_notes_beside', input),
  );
  return answer.structuredContent;
}

describe('the callers an MCP endpoint rejects before the MCP SDK runs', () => {
  it('answers a request without a key with a 401 problem document and a Bearer challenge', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', {});

    expect({ status: answer.status, type: answer.headers.get('content-type') }).toEqual({
      status: 401,
      type: 'application/problem+json',
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each(otherCallers)('rejects a key on %s with a 403 problem document', async (_case, path, key, detail) => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, path, { authorization: `Bearer ${key}` });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toEqual({
      status: 403,
      body: forbiddenProblem(detail),
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"');
  });
});

describe('credentials of a scheme the API does not know, at an MCP endpoint', () => {
  it.each(['/mcp', '/orgs/acme/mcp', '/orgs/acme/playbooks/alpha/mcp'])(
    'refuses a Request header on %s as a malformed Authorization header, as over HTTP',
    async (path) => {
      const { handler } = await operationServer();

      const answer = await postMcp(handler, path, { authorization: 'Request a-token-of-a-request' });

      expect({ status: answer.status, body: jsonOf(answer.text) }).toMatchObject({
        status: 400,
        body: {
          reason: 'bad_request',
          detail: anyWords,
        },
      });
      expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_request"');
    },
  );
});

describe('the origins an MCP endpoint rejects', () => {
  it('rejects an origin that is not allowed with a 403 problem document', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, origin: 'https://evil.example' });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toMatchObject({
      status: 403,
      body: { reason: 'origin_not_allowed' },
    });
  });
});

describe('the methods of an MCP endpoint', () => {
  it.each(['GET', 'DELETE', 'PUT'])('answers %s with 405, a problem document and Allow: POST', async (method) => {
    const { handler } = await operationServer();

    const answer = await call(handler, '/orgs/acme/mcp', { method, headers: asAdmin });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(answer.headers.get('allow')).toBe('POST');
  });

  it('answers HEAD with 405 and Allow: POST', async () => {
    const { handler } = await operationServer();

    const answer = await call(handler, '/orgs/acme/playbooks/alpha/mcp', { method: 'HEAD', headers: asAdmin });

    expect({ status: answer.status, allow: answer.headers.get('allow') }).toEqual({ status: 405, allow: 'POST' });
  });
});

describe('an MCP endpoint once the MCP SDK runs', () => {
  it('answers a body that is not JSON with the SDK’s own JSON-RPC error and 415, and reports it', async () => {
    const { handler, mcpErrors } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, 'content-type': 'text/plain' });

    expect({ status: answer.status, type: answer.headers.get('content-type'), body: jsonOf(answer.text) }).toEqual({
      status: 415,
      type: 'application/json',
      body: sdkError('Unsupported Media Type: Content-Type must be application/json'),
    });
    expect(mcpErrors()).toEqual(['Unsupported Media Type: Content-Type must be application/json']);
  });

  it('answers a body over 1 MiB and 64 KiB with the SDK’s own JSON-RPC error and 413, and accepts one at the limit', async () => {
    const { handler } = await operationServer();
    const envelope = pingWithPadding(0).length;

    const over = await postMcp(handler, '/orgs/acme/mcp', asAdmin, pingWithPadding(limit - envelope + 1));
    const atLimit = await postMcp(handler, '/orgs/acme/mcp', asAdmin, pingWithPadding(limit - envelope));

    expect({ status: over.status, body: jsonOf(over.text) }).toEqual({
      status: 413,
      body: sdkError('Payload Too Large: Request body must not exceed 1114112 bytes'),
    });
    expect(atLimit.status).not.toBe(413);
  });

  it('answers a client that does not accept an event stream with the SDK’s own JSON-RPC error and 406', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, accept: 'application/json' });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toEqual({
      status: 406,
      body: sdkError('Not Acceptable: Client must accept both application/json and text/event-stream'),
    });
  });

  it('admits the local developer in local mode without a key', async () => {
    const { handler } = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });

    const answer = await postMcp(handler, '/orgs/acme/mcp', { host: 'localhost:5555' });

    expect(answer.status).toBe(200);
    expect(answer.text).toContain('"serverInfo":{"name":"@on.auto/runtime"');
  });
});

describe('directory endpoint', () => {
  beforeAll(async () => {
    server = await operationServer({ operations: [inTheOrg, inAPlaybook] });
    listening = await listenOnLoopback(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('the directory listing at /directory', () => {
    it('lists the tools of /mcp, and its calls reach the org and a playbook as calls through the directory listing', async () => {
      const [everything, directory] = [await calledAt('/mcp'), await calledAt('/directory')];

      expect(directory.tools).toEqual(everything.tools);
      expect([everything.inTheOrg, everything.inAPlaybook]).toEqual(['Outside it.', 'Outside it.']);
      expect([directory.inTheOrg, directory.inAPlaybook]).toEqual(['In the listing.', 'In the listing.']);
    });
  });
});

describe('mcp boundary', () => {
  beforeAll(async () => {
    server = await operationServer();
    listening = await listenOnLoopback(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('a tool call that throws', () => {
    it('answers isError with an internal problem, and reports the error under its incident id', async () => {
      const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
      const ownListening = await listenOnLoopback(handler);

      const result = await withMcpSession(
        'current revision',
        { url: `${ownListening.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
        (session) => session.callTool('list_notes'),
      );
      await ownListening.close();
      const [report] = reported;

      expect({ isError: result.isError, problem: problemIn(result) }).toEqual({
        isError: true,
        problem: {
          type: 'https://on.auto/problems/internal',
          title: 'Internal error',
          status: 500,
          detail: 'An unexpected error occurred',
          reason: 'internal',
          instance: `urn:uuid:${String(report?.incident)}`,
        },
      });
      expect(report?.message).toBe('the runtime broke while holding database password hunter2');
      expect(JSON.stringify(result)).not.toContain('hunter2');
      expect(sdkErrors).toEqual([]);
      expect(plainTextIn(result)).toBe(
        `Could not list the notes: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: ${String(report?.incident)}.`,
      );
    });
  });

  describe('a tool call on /mcp that throws', () => {
    it('names in its words what was asked of an operation whose input has no field, given only its playbook', async () => {
      const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
      const ownListening = await listenOnLoopback(handler);

      const result = await withMcpSession(
        'current revision',
        { url: `${ownListening.origin}/mcp`, headers: {} },
        (session) => session.callTool('latest_note', { playbook: 'alpha' }),
      );
      await ownListening.close();

      expect(result.isError).toBe(true);
      expect(plainTextIn(result)).toBe(
        `Could not read the latest note: something went wrong inside the server. It was not caused by anything you did. If it happens again, whoever runs the server can look into it with this reference: ${String(reported[0]?.incident)}.`,
      );
    });
  });

  describe('an operation without plain language', () => {
    it('cannot be served as an MCP tool, so no result falls back to bare JSON', () => {
      const bare = defineQuery('playbook', {
        name: 'bare_query',
        title: 'Bare query',
        description: 'Answers without plain language. Use it in tests. It answers nothing.',
        route: { method: 'GET', path: '/bare' },
        inputSchema: Schema.Struct({ size: Schema.Int }),
        outputSchema: Schema.Struct({ size: Schema.Int }),
        reasons: [],
        handle: ({ size }) => Effect.succeed({ size }),
      });
      const serving = mcpRoutes({
        catalog: makeCatalog([bare]),
        dispatcher: makeDispatcher([]),
        runCall: () => Promise.reject(new Error('not called')),
        serverInfo: testServerInfo,
        retryStateKeys: testRetryStateKeys,
        shelf: emptyShelf,
        reportError: () => {
          sdkErrors.push('unexpected');
        },
      });

      expect(() => createTestHandler({ routes: [serving] })).toThrow(
        'The operation bare_query has no plain language for the results of its MCP tool',
      );
    });
  });

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
      expect(['add_note', 'check_lines', 'send_notes'].filter((name) => outcome.instructions.includes(name))).toEqual(
        [],
      );
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

  describe('an argument given as JSON text', () => {
    it('is taken as the value its text holds, and answered in the words of that value', async () => {
      const result = await checkingLines(JSON.stringify(['Fine', 'Also fine']));

      expect({ isError: result.isError, structuredContent: result.structuredContent }).toEqual({
        isError: undefined,
        structuredContent: { in_words: anyWords, accepted: 2 },
      });
    });
  });

  describe('the playbooks of the caller of a tool', () => {
    it('let a key limited to some playbooks call the tools of a playbook it may access', async () => {
      const added = await withMcpSession(
        'current revision',
        endpoint('/orgs/acme/playbooks/alpha/mcp', acmeAlphaWriter.key),
        (session) => session.callTool('add_note', { name: 'limited', text: 'yes' }),
      );

      expect(added.structuredContent).toEqual({ in_words: 'Added the note “limited”.', name: 'limited', text: 'yes' });
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

      expect(labelled.own.structuredContent).toEqual({
        in_words: 'Done: label a playbook.',
        playbook: 'alpha',
        label: 'a',
      });
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
});

describe('mcp call permission', () => {
  beforeAll(async () => {
    server = await operationServer({
      callContext: () => Context.make(CallPermission, callPermissionDecidedBy(queriesAlone)),
    });
    listening = await listenOnLoopback(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('the tools an endpoint lists, where the context of the call says a decision point decides who may call what', () => {
    it('are those the decision point allows the caller, asked once for each tool, whatever the credential grants', async () => {
      expect({
        playbook: await listedOn('/orgs/acme/playbooks/alpha/mcp'),
        org: await listedOn('/orgs/acme/mcp'),
        ownOrg: await listedOn('/mcp'),
      }).toEqual({
        playbook: ['list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
        org: ['list_labels', guideToolName],
        ownOrg: ['list_labels', 'list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
      });
    });
  });
});

describe('mcp sign in', () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map(({ close }) => close()));
  });

  describe('an agent signing in through the authorization server the metadata names', () => {
    it('connects with the SDK’s client, is challenged, gets a token of every scope asked for the resource, is told it acts as the person and calls the tools', async () => {
      const issuer = await issuerOnLoopback(clients);
      const runtime = await signedInOnLoopback(issuer.served);
      opened.push(issuer, runtime);
      const client = new Client({ name: 'auto-runtime-tests', version: '2.0.0' });
      const authProvider = new ClientCredentialsProvider({
        clientId: 'ada-agent',
        clientSecret: 'a-secret-only-ada-holds',
        expectedIssuer: issuer.origin,
      });

      await client.connect(new StreamableHTTPClientTransport(new URL(`${runtime.origin}/mcp`), { authProvider }));
      const instructions = client.getInstructions();
      const tools = await client.listTools();
      await client.callTool({
        name: 'add_note',
        arguments: { playbook: 'alpha', name: 'from-ada', text: 'signed in' },
      });
      const notes = await client.callTool({ name: 'list_notes', arguments: { playbook: 'alpha' } });
      await client.close();

      const [, claims] = String(authProvider.tokens()?.access_token).split('.');

      expect(instructions).toContain(' This connection acts as Ada Lovelace (person:ada) in the org acme. ');
      expect(toolNamesIn(tools)).toContain('add_note');
      expect(notes.structuredContent).toEqual({
        in_words: 'Done: list the notes.',
        notes: [{ name: 'from-ada', text: 'signed in' }],
      });
      expect(JSON.parse(Buffer.from(String(claims), 'base64url').toString('utf8'))).toMatchObject({
        iss: issuer.origin,
        aud: runtime.origin,
        sub: 'ada',
        scope: 'user:org:read org:read org:write playbook:read playbook:write',
      });
    });
  });
});

describe('operations served', () => {
  beforeAll(async () => {
    server = await operationServer({ operations: [keepNote, keepsNotesBeside] });
    listening = await listenOnLoopback(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('the operations a call reads as served beside it', () => {
    it('are the tools of the MCP endpoint that serves it, and every operation over HTTP', async () => {
      const overHttp = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes-beside', { headers: asAdmin });

      expect([
        await servedOver('/mcp', { playbook: 'alpha' }),
        await servedOver('/orgs/acme/playbooks/alpha/mcp', {}),
        overHttp.body,
      ]).toEqual([{ in_words: 'Said it.', served: true }, { in_words: 'Said it.', served: false }, { served: true }]);
    });
  });
});
