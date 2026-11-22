import { Client, ClientCredentialsProvider, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { authenticatorFor } from '@on.auto/identity';
import {
  type AccessDecision,
  type AccessRequest,
  busyRefusal,
  type CallAsked,
  CallPermission,
  callPermissionDecidedBy,
  defineCommand,
  defineQuery,
  deniedFor,
  DirectoryListing,
  makeCatalog,
  makeDispatcher,
  OperationsServed,
  type PolicyDecisionPoint,
  undecidedMessage,
} from '@on.auto/operations';
import { capturedLogs } from '@on.auto/operations/testing';
import { Context, Effect, Logger, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { guideShelfOf, mcpCallsNotedIn, mcpRoutes, type McpCallNoted } from '../index.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
import { fetchInProcess, listenInProcess, type Listening } from '../testing/listening.ts';
import {
  connectMcp,
  type McpConnection,
  plainTextIn,
  problemIn,
  type ToolResult,
  toolResultOf,
  withMcpSession,
} from '../testing/mcp-clients.ts';
import { initializeAt, jsonOf, messagesIn, postMcp, requestOf, type RawAnswer } from '../testing/mcp-requests.ts';
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

const anyCount: unknown = expect.any(Number);

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

function decidedForQueriesAlone(request: AccessRequest): AccessDecision {
  return request.context.operation.kind === 'query' ? allowed : denied;
}

const asked: { decisions: number; readonly batches: number[] } = { decisions: 0, batches: [] };

const queriesAlone: PolicyDecisionPoint = {
  decide: (request) =>
    Effect.sync(() => {
      asked.decisions += 1;
      return decidedForQueriesAlone(request);
    }),
  decideBatch: (requests) =>
    Effect.sync(() => {
      asked.batches.push(requests.length);
      return requests.map((request) => decidedForQueriesAlone(request));
    }),
};

function listedOn(path: string): Promise<readonly string[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => toolNamesIn(await session.listTools()),
  );
}

const clients = {
  'ada-agent': {
    secret: 'a-secret-only-ada-holds',
    claims: { sub: 'ada', name: 'Ada Lovelace', org_id: 'acme', org_name: 'Initech' },
  },
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

async function notedWhilePosting(
  handler: Awaited<ReturnType<typeof operationServer>>['handler'],
  path: string,
  body: string,
): Promise<readonly McpCallNoted[]> {
  const told: Promise<McpCallNoted>[] = [];
  await mcpCallsNotedIn(
    () => postMcp(handler, path, asAdmin, body),
    (noted) => {
      told.push(noted);
    },
  );
  return Promise.all(told);
}

describe('the MCP calls an endpoint notes for the line of its request', () => {
  it('names a listing and a call of a tool with its declared arguments, the bytes each way and how each ended', async () => {
    const { handler } = await operationServer();
    const calling = requestOf(2, 'tools/call', {
      name: 'add_note',
      arguments: { name: 'n1', text: 'Ada', secret: 'x' },
    });

    const listing = requestOf(1, 'tools/list');
    const listed = await notedWhilePosting(handler, '/orgs/acme/playbooks/alpha/mcp', listing);
    const called = await notedWhilePosting(handler, '/orgs/acme/playbooks/alpha/mcp', calling);
    const unknown = await notedWhilePosting(handler, '/orgs/acme/mcp', requestOf(3, 'tools/call', { name: 'Ada' }));

    expect(listed).toEqual([
      { method: 'tools/list', request_bytes: listing.length, response_bytes: listed[0]?.response_bytes, listed: 9 },
    ]);
    expect(called).toEqual([
      {
        method: 'tools/call',
        tool: 'add_note',
        operation: 'add_note',
        arguments: 'name,text',
        undeclared: 1,
        request_bytes: calling.length,
        response_bytes: called[0]?.response_bytes,
        tool_errors: 1,
      },
    ]);
    expect([listed[0]?.response_bytes, called[0]?.response_bytes]).toEqual([anyCount, anyCount]);
    expect(unknown).toEqual([
      expect.objectContaining({ method: 'tools/call', tool: 'unknown', errors: 1, error_code: -32_602 }),
    ]);
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
    listening = listenInProcess(server.handler);
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
    listening = listenInProcess(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('a tool call that throws', () => {
    it('answers isError with an internal problem, and reports the error under its incident id', async () => {
      const { handler, reported } = createTestHandler({ routes: [brokenRuntime] });
      const ownListening = listenInProcess(handler);

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
      const ownListening = listenInProcess(handler);

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

  describe('the instructions of the org endpoint', () => {
    it('give the address of a playbook endpoint with the id of the org the key belongs to, which serves that playbook', async () => {
      const instructions = await withMcpSession(
        'current revision',
        endpoint('/orgs/acme/mcp', acmeReader.key),
        (session) => Promise.resolve(String(session.instructions)),
      );
      const address = '/orgs/acme/playbooks/{playbook}/mcp';

      const served = await withMcpSession(
        'current revision',
        endpoint(address.replace('{playbook}', 'alpha'), acmeReader.key),
        async (session) => toolNamesIn(await session.listTools()),
      );

      expect(instructions).toContain(address);
      expect(instructions).not.toContain('{org}');
      expect(served).toContain('list_notes');
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
    listening = listenInProcess(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  describe('the tools an endpoint lists, where the context of the call says a decision point decides who may call what', () => {
    it('are those the decision point allows the caller, asked in one batch for each listing, whatever the credential grants', async () => {
      expect({
        playbook: await listedOn('/orgs/acme/playbooks/alpha/mcp'),
        org: await listedOn('/orgs/acme/mcp'),
        ownOrg: await listedOn('/mcp'),
      }).toEqual({
        playbook: ['list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
        org: ['list_labels', guideToolName],
        ownOrg: ['list_labels', 'list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
      });
      const [playbook = 0, , org = 0, , ownOrg = 0] = asked.batches;
      expect(asked.decisions).toBe(0);
      expect(asked.batches).toEqual([playbook, playbook, org, org, ownOrg, ownOrg]);
      expect(ownOrg).toBe(playbook + org);
    });
  });
});

const decodeAnswer = Schema.decodeUnknownSync(Schema.Struct({ result: Schema.Unknown }));

function resultIn(message: unknown): unknown {
  return decodeAnswer(message).result;
}

const undecidedScopes = new Set<string>();

function undecidedFor(scopes: readonly string[]): void {
  for (const scope of scopes) {
    undecidedScopes.add(scope);
  }
}

function decidedUnlessUndecided(each: readonly CallAsked[]) {
  return each.some(({ operation }) => undecidedScopes.has(operation.scope))
    ? Effect.fail(busyRefusal('nothing was done', 2))
    : Effect.succeed(each.map(() => true));
}

const busyProblem = {
  type: 'https://on.auto/problems/busy',
  status: 503,
  reason: 'unavailable',
  kind: 'busy',
  retry_after: 2,
};

const askedWhileUndecided: ReadonlyArray<readonly [string, string]> = [
  ['initialize', initializeAt('2025-11-25')],
  ['tools/list', requestOf(2, 'tools/list')],
  ['prompts/list', requestOf(2, 'prompts/list')],
  ['prompts/get', requestOf(2, 'prompts/get', { name: 'start' })],
  ['resources/list', requestOf(2, 'resources/list')],
  ['a tool it does not have', requestOf(2, 'tools/call', { name: 'no_such_tool', arguments: {} })],
];

const undecidedEndpoints: ReadonlyArray<readonly [string, readonly string[], string, object]> = [
  ['/mcp', ['org', 'playbook'], 'list_labels', {}],
  ['/mcp', ['playbook'], 'list_notes', { arguments: { playbook: 'alpha' } }],
  ['/orgs/acme/mcp', ['org'], 'list_labels', { arguments: {} }],
  ['/orgs/acme/playbooks/alpha/mcp', ['playbook'], 'list_notes', {}],
];

const underTheRevision = { ...asAdmin, 'mcp-protocol-version': '2025-11-25' };

describe('an MCP endpoint whose listing is not decided in time', () => {
  beforeAll(async () => {
    server = await operationServer({ callContext: () => Context.make(CallPermission, decidedUnlessUndecided) });
  });

  afterEach(() => {
    undecidedScopes.clear();
  });

  afterAll(async () => {
    await server.runtime.dispose();
  });

  describe.each(undecidedEndpoints)('at %s, undecided for %j', (path, scopes, tool, input) => {
    it.each(askedWhileUndecided)('answers %s as busy, with the wait, never as missing', async (_asked, body) => {
      undecidedFor(scopes);

      const answer = await postMcp(server.handler, path, underTheRevision, body);

      expect(messagesIn(answer)).toMatchObject([{ error: { code: -32_000, message: anyWords, data: busyProblem } }]);
    });

    it('answers a call of a tool it may list with an isError result whose problem is busy', async () => {
      undecidedFor(scopes);

      const answer = await postMcp(
        server.handler,
        path,
        underTheRevision,
        requestOf(2, 'tools/call', { name: tool, ...input }),
      );
      const results = messagesIn(answer).map((message) => toolResultOf(resultIn(message)));

      expect(results.map(({ isError }) => isError)).toEqual([true]);
      expect(results.map((result) => problemIn(result))).toMatchObject([busyProblem]);
    });

    it('lists every tool again once the listing is decided in time', async () => {
      const answer = await postMcp(server.handler, path, underTheRevision, requestOf(2, 'tools/list'));

      expect(messagesIn(answer).flatMap((message) => toolNamesIn(resultIn(message)))).toContain(tool);
    });
  });
});

interface Heard {
  readonly status: number;
  readonly message: unknown;
}

function heardIn(answer: RawAnswer): Heard {
  const [message] = messagesIn(answer);
  return { status: answer.status, message };
}

/** What a client of 2026-07-28 hears as it connects: its `server/discover`, since it has no `initialize`. */
async function discoveryHeardOn(path: string): Promise<readonly Heard[]> {
  const heard: Heard[] = [];
  const recorded = async (...posted: readonly [unknown, unknown?]): Promise<Response> => {
    const answer = await fetchInProcess(...posted);
    heard.push(heardIn({ status: answer.status, headers: answer.headers, text: await answer.clone().text() }));
    return answer;
  };
  await expect(connectMcp('current revision', { ...endpoint(path, acmeAdmin.key), fetch: recorded })).rejects.toThrow(
    Error,
  );
  return heard;
}

describe('an MCP endpoint whose listing is busy, to a client of 2026-07-28', () => {
  beforeAll(async () => {
    server = await operationServer({ callContext: () => Context.make(CallPermission, decidedUnlessUndecided) });
    listening = listenInProcess(server.handler);
  });

  afterEach(() => {
    undecidedScopes.clear();
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  it('refuses its connection as busy, as every other request, so it never connects without instructions', async () => {
    undecidedFor(['org', 'playbook']);

    expect(await discoveryHeardOn('/mcp')).toMatchObject([
      { status: 200, message: { error: { code: -32_000, data: busyProblem } } },
    ]);
  });
});

const callsRun = { count: 0 };

const counting = {
  title: 'Count',
  description: 'Counts one call. Use it to count the calls that ran. It answers the count.',
  inputSchema: takesNothing,
  outputSchema: Schema.Struct({ counted: Schema.Number }),
  reasons: [],
  handle: () =>
    Effect.sync(() => {
      callsRun.count += 1;
      return { counted: callsRun.count };
    }),
  plainLanguage: { task: 'count a call', attempt: () => 'count the call', outcome: () => 'Counted.' },
};

const countInTheOrg = defineCommand('org', {
  ...counting,
  name: 'count_in_the_org',
  route: { method: 'POST', path: '/counted' },
});

const countInAPlaybook = defineCommand('playbook', {
  ...counting,
  name: 'count_in_a_playbook',
  route: { method: 'POST', path: '/counted' },
});

const undecidedByTheTest = deniedFor(['the roles could not be read']);

const failingOutright: PolicyDecisionPoint = {
  decide: () => Effect.succeed(undecidedByTheTest),
  decideBatch: (requests) => Effect.succeed(requests.map(() => undecidedByTheTest)),
};

const failedLogs = capturedLogs();

const endpointsWhoseCheckFails: ReadonlyArray<readonly [string, string]> = [
  ['/mcp', 'count_in_the_org'],
  ['/directory', 'count_in_the_org'],
  ['/orgs/acme/mcp', 'count_in_the_org'],
  ['/orgs/acme/playbooks/alpha/mcp', 'count_in_a_playbook'],
];

function askedWhileTheCheckFails(tool: string): readonly string[] {
  return [
    initializeAt('2025-11-25'),
    requestOf(2, 'tools/list'),
    requestOf(3, 'prompts/list'),
    requestOf(4, 'prompts/get', { name: 'take-a-note', arguments: { text: 'a note' } }),
    requestOf(5, 'resources/read', { uri: 'guide://notebook' }),
    requestOf(6, 'tools/call', { name: tool, arguments: {} }),
    requestOf(7, 'ping'),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  ];
}

const unavailableProblem = { type: 'https://on.auto/problems/unavailable', status: 503, reason: 'unavailable' };

const refusedAsUnavailable = { error: { code: -32_000, data: unavailableProblem } };

const answeredWhileTheCheckFails = [
  { status: 200, message: { id: 1, ...refusedAsUnavailable } },
  { status: 200, message: { id: 2, ...refusedAsUnavailable } },
  { status: 200, message: { id: 3, ...refusedAsUnavailable } },
  { status: 200, message: { id: 4, ...refusedAsUnavailable } },
  { status: 200, message: { id: 5, ...refusedAsUnavailable } },
  { status: 200, message: { id: 6, result: { isError: true } } },
  { status: 200, message: { id: 7, result: {} } },
  { status: 202, message: undefined },
];

const RefusalSchema = Schema.Struct({
  reason: Schema.String,
  detail: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  retry_after: Schema.optionalKey(Schema.Number),
});

const refusalOf = Schema.decodeUnknownSync(RefusalSchema);

const errorAnswerOf = Schema.decodeUnknownSync(
  Schema.Struct({ error: Schema.Struct({ message: Schema.String, data: RefusalSchema }) }),
);

function refusedAsAnError({ message }: Heard): unknown {
  const { error } = errorAnswerOf(message);
  const { reason, kind, retry_after: wait } = error.data;
  return { reason, kind, wait, wordsAlone: error.message === error.data.detail };
}

function refusedAsACall({ message }: Heard): unknown {
  const result = toolResultOf(resultIn(message));
  const { reason, kind, retry_after: wait, detail } = refusalOf(problemIn(result));
  return { isError: result.isError, reason, kind, wait, wordsAlone: plainTextIn(result) === detail };
}

describe('an MCP endpoint whose listing’s check fails outright', () => {
  beforeAll(async () => {
    server = await operationServer({
      operations: [countInTheOrg, countInAPlaybook],
      callContext: () =>
        Context.add(
          Context.make(CallPermission, callPermissionDecidedBy(failingOutright)),
          Logger.CurrentLoggers,
          failedLogs.loggers,
        ),
    });
    listening = listenInProcess(server.handler);
  });

  afterAll(async () => {
    await listening.close();
    await server.runtime.dispose();
  });

  it('refuses in band as plainly unavailable what is answered from the listing, the connection included, runs nothing, answers ping and notifications, and logs once a request', async () => {
    const heard: readonly (readonly Heard[])[] = await Promise.all(
      endpointsWhoseCheckFails.map(async ([path, tool]) =>
        (
          await Promise.all(
            askedWhileTheCheckFails(tool).map((body) => postMcp(server.handler, path, underTheRevision, body)),
          )
        ).map((answer) => heardIn(answer)),
      ),
    );
    const discovered: readonly (readonly Heard[])[] = await Promise.all(
      endpointsWhoseCheckFails.map(([path]) => discoveryHeardOn(path)),
    );

    expect(heard).toMatchObject(endpointsWhoseCheckFails.map(() => answeredWhileTheCheckFails));
    expect(discovered).toMatchObject(
      endpointsWhoseCheckFails.map(() => [{ status: 200, message: refusedAsUnavailable }]),
    );
    const refusedWithAnError = [...heard.flatMap((answers) => answers.slice(0, 5)), ...discovered.flat()];
    expect(refusedWithAnError.map((answer) => refusedAsAnError(answer))).toEqual(
      refusedWithAnError.map(() => ({ reason: 'unavailable', kind: undefined, wait: undefined, wordsAlone: true })),
    );
    expect(heard.flatMap((answers) => answers.slice(5, 6)).map((answer) => refusedAsACall(answer))).toEqual(
      endpointsWhoseCheckFails.map(() => ({
        isError: true,
        reason: 'unavailable',
        kind: undefined,
        wait: undefined,
        wordsAlone: true,
      })),
    );
    expect(callsRun.count).toBe(0);
    expect(failedLogs.logged().filter(({ message }) => message === undecidedMessage)).toHaveLength(
      heard.flat().length + discovered.flat().length,
    );
  });
});

describe('mcp sign in', () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map(({ close }) => close()));
  });

  describe('an agent signing in through the authorization server the metadata names', () => {
    it('connects with the SDK’s client, is challenged, gets a token of every scope asked for the resource, is told it acts for the person in the organization its token names, and calls the tools', async () => {
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

      expect(
        ['Ada Lovelace', 'person:ada', 'Initech'].filter((named) => !String(instructions).includes(named)),
      ).toEqual([]);
      expect(instructions).not.toContain('acme');
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
    listening = listenInProcess(server.handler);
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
