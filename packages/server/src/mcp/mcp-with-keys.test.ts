import { problemIn, toolNamesIn, withMcpSession, type McpConnection } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { release } from '../composition/release.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const acmeReader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const acmeAlpha = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, playbooks: ['alpha'] });

const apiKeys = JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlpha.entry]);

const playbookTools = ['create_playbook', 'list_playbooks', 'update_playbook', 'retire_playbook'];

const definitionTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'list_playbook_events',
  'get_event',
  'publish_event',
  'search',
  'introspect',
  'dry_run',
  'execute',
  'answer_interaction',
  'list_interactions',
  'send_run_event',
];

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      API_KEYS: apiKeys,
    },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function endpoint(path: string, key: string): McpConnection {
  return { url: `http://127.0.0.1:${server.port}${path}`, headers: { authorization: `Bearer ${key}` } };
}

function postInitialize(path: string, headers: Readonly<Record<string, string>>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'server-tests', version: '1' } },
    }),
  });
}

describe('the org endpoint of the server', () => {
  it('names the release under the title Auto Runtime and lists the four playbook tools, list_models, search and the three of connections', async () => {
    const connected = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/mcp', acmeAdmin.key),
      async (session) => ({
        serverVersion: session.serverVersion,
        tools: toolNamesIn(await session.listTools()),
      }),
    );

    expect(connected).toEqual({
      serverVersion: { ...release, title: 'Auto Runtime' },
      tools: [
        ...playbookTools,
        'list_models',
        'search',
        'add_connection',
        'list_connections',
        'remove_connection',
        'get_guide',
      ],
    });
  });

  it('answers a playbook the org lacks as isError with a not_found problem', async () => {
    const missing = await withMcpSession('previous revision', endpoint('/orgs/acme/mcp', acmeAdmin.key), (session) =>
      session.callTool('search', { playbook: 'nowhere' }),
    );

    expect({ isError: missing.isError, problem: problemIn(missing) }).toMatchObject({
      isError: true,
      problem: { status: 404, reason: 'not_found' },
    });
  });
});

describe('the playbook tools of the server', () => {
  it('create, list, update and retire a playbook, listed with every field it was created with', async () => {
    const outcome = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/mcp', acmeAdmin.key),
      async (session) => ({
        created: await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
        listed: await session.callTool('list_playbooks', {}),
        updated: await session.callTool('update_playbook', {
          playbook: 'alpha',
          name: 'Alpha prime',
          description: 'Notes',
        }),
        retired: await session.callTool('retire_playbook', { playbook: 'alpha' }),
      }),
    );
    expect(outcome.created.structuredContent).toMatchObject({ id: 'alpha', name: 'Alpha', status: 'active' });
    expect(outcome.listed.structuredContent).toEqual({ playbooks: [outcome.created.structuredContent] });
    expect(outcome.updated.structuredContent).toMatchObject({ name: 'Alpha prime', description: 'Notes' });
    expect(outcome.retired.structuredContent).toMatchObject({ status: 'retired' });
  });
});

describe('the callers the MCP endpoints of the server reject before MCP', () => {
  it('answers a request without a key with a 401 problem document before MCP', async () => {
    const answer = await postInitialize('/orgs/acme/mcp', {});

    expect({ status: answer.status, type: answer.headers.get('content-type') }).toEqual({
      status: 401,
      type: 'application/problem+json',
    });
  });

  it('rejects a key of another org with a 403 problem document', async () => {
    const answer = await postInitialize('/orgs/globex/mcp', { authorization: `Bearer ${acmeAdmin.key}` });

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller does not belong to this org' },
    });
  });
});

const queriesOfTheOrg = ['list_playbooks', 'list_models', 'search', 'list_connections', 'get_guide'];

describe('the permissions and playbooks of a key over MCP', () => {
  it('offer a read-only key the queries of the org and no command, and serve it a query', async () => {
    const outcome = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/mcp', acmeReader.key),
      async (session) => ({
        tools: toolNamesIn(await session.listTools()),
        listed: await session.callTool('list_playbooks', {}),
      }),
    );

    expect(outcome.tools).toEqual(queriesOfTheOrg);
    expect(outcome.listed.structuredContent).toEqual({ playbooks: [] });
  });

  it('confine a key limited to some playbooks to the playbook endpoints of those playbooks', async () => {
    const other = await postInitialize('/orgs/acme/playbooks/beta/mcp', { authorization: `Bearer ${acmeAlpha.key}` });
    const own = await withMcpSession(
      'current revision',
      endpoint('/orgs/acme/playbooks/alpha/mcp', acmeAlpha.key),
      (session) => session.listTools(),
    );

    expect({ status: other.status, body: await other.json() }).toMatchObject({
      status: 403,
      body: { detail: 'The caller may not access this playbook' },
    });
    expect(toolNamesIn(own)).toEqual([...definitionTools, 'get_guide']);
  });

  it('lists the definition tools on the playbook endpoint of a playbook that does not exist, whose calls find no playbook', async () => {
    const { tools, listed } = await withMcpSession(
      'previous major',
      endpoint('/orgs/acme/playbooks/nowhere/mcp', acmeAdmin.key),
      async (session) => ({
        tools: await session.listTools(),
        listed: await session.callTool('list_definitions', { type: 'reasoning' }),
      }),
    );

    expect(toolNamesIn(tools)).toEqual([...definitionTools, 'get_guide']);
    expect({ isError: listed.isError, problem: problemIn(listed) }).toMatchObject({
      isError: true,
      problem: { reason: 'not_found' },
    });
  });
});
