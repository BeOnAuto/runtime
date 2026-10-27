import {
  mcpClientKinds,
  problemIn,
  toolNamesIn,
  withMcpSession,
  type McpClientKind,
  type McpSession,
} from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const listResultOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown })));

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const acmeAlpha = createApiKey({ id: 'acme-alpha', org: 'acme', permissions: allPermissions, playbooks: ['alpha'] });

const acmePlaybookReader = createApiKey({
  id: 'acme-playbook-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: '*',
});

const queriesInsideAPlaybook = [
  'list_definitions',
  'get_definition',
  'get_run',
  'list_runs',
  'list_playbook_events',
  'get_event',
  'introspect',
  'dry_run',
  'list_interactions',
];

const commands = [
  'create_playbook',
  'update_playbook',
  'retire_playbook',
  'create_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'cancel_run',
  'publish_event',
  'execute',
  'answer_interaction',
  'send_run_event',
  'activate_license',
];

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, playbooks: '*' });

const apiKeys = JSON.stringify([
  acmeAdmin.entry,
  acmeReader.entry,
  acmeAlpha.entry,
  acmePlaybookReader.entry,
  globexAdmin.entry,
]);

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: apiKeys });
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: acmeAdmin.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: acmeAdmin.key,
    body: { playbook: 'beta', name: 'Beta' },
  });
});

afterEach(async () => {
  await server.stop();
});

function asKey<T>(
  key: string,
  use: (session: McpSession) => Promise<T>,
  kind: McpClientKind = 'current revision',
): Promise<T> {
  return withMcpSession(kind, { url: `${server.origin}/mcp`, headers: { authorization: `Bearer ${key}` } }, use);
}

describe('the org of a key on /mcp', () => {
  it('is the only one the key reaches, whatever playbook or org the arguments name', async () => {
    const outcome = await asKey(globexAdmin.key, async (session) => ({
      listed: await session.callTool('list_playbooks', {}),
      searched: await session.callTool('search', { playbook: 'alpha' }),
      definitions: await session.callTool('list_definitions', { playbook: 'alpha', type: 'reasoning' }),
      named: await session.callTool('list_playbooks', { org: 'acme' }),
    }));

    expect(outcome.listed.structuredContent).toEqual({ playbooks: [] });
    expect(problemIn(outcome.searched)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no playbook alpha in this org',
    });
    expect(problemIn(outcome.definitions)).toMatchObject({
      reason: 'not_found',
      detail: 'There is no playbook alpha in this org',
    });
    expect(problemIn(outcome.named)).toMatchObject({ reason: 'invalid_input', errors: [{ pointer: '/org' }] });
  });
});

describe('a key limited to one playbook on /mcp', () => {
  it('lists only that playbook and is refused every other with forbidden', async () => {
    const outcome = await asKey(acmeAlpha.key, async (session) => ({
      listed: await session.callTool('list_playbooks', {}),
      own: await session.callTool('list_definitions', { playbook: 'alpha', type: 'reasoning' }),
      other: await session.callTool('list_definitions', { playbook: 'beta', type: 'reasoning' }),
    }));

    expect(outcome.listed.structuredContent).toMatchObject({ playbooks: [{ id: 'alpha' }] });
    expect(outcome.own.structuredContent).toEqual({ definitions: [] });
    expect(problemIn(outcome.other)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may not access this playbook',
    });
  });
});

describe('the tool servers on /mcp, for a key limited to one playbook', () => {
  it('are those of its playbook, and those of the whole org are refused it with words that say to name its playbook', async () => {
    const outcome = await asKey(acmeAlpha.key, async (session) => ({
      own: await session.callTool('search', { playbook: 'alpha' }),
      org: await session.callTool('search', {}),
    }));

    expect(outcome.own.structuredContent).toEqual({ servers: [], tools: [], scopes: [] });
    expect(problemIn(outcome.org)).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller may access only some playbooks of this org; name one of them in playbook',
    });
  });
});

describe('a read-only key on /mcp', () => {
  it('is served its queries and offered no command', async () => {
    const outcome = await asKey(acmeReader.key, async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      listed: await session.callTool('list_playbooks', {}),
    }));

    expect(outcome.tools).toEqual([
      'list_playbooks',
      'list_models',
      'search',
      'list_connections',
      ...queriesInsideAPlaybook,
      'get_guide',
    ]);
    expect(outcome.listed.structuredContent).toMatchObject({ playbooks: [{ id: 'alpha' }, { id: 'beta' }] });
  });

  it('answers a command it is not offered as a tool the endpoint does not list', async () => {
    await expect(
      asKey(acmeReader.key, (session) => session.callTool('create_playbook', { playbook: 'gamma', name: 'Gamma' })),
    ).rejects.toThrow('Tool create_playbook not found');
  });
});

describe('a key that may only read inside playbooks, on /mcp', () => {
  it('lists the playbooks it may read, the queries inside a playbook and no command, and its instructions name no command', async () => {
    const outcome = await asKey(acmePlaybookReader.key, async (session) => ({
      tools: toolNamesIn(await session.listTools()),
      instructions: String(session.instructions),
      listed: await session.callTool('list_playbooks', {}),
    }));

    expect(outcome.tools).toEqual(['list_playbooks', 'search', ...queriesInsideAPlaybook, 'get_guide']);
    expect(commands.filter((name) => new RegExp(`\\b${name}\\b`, 'u').test(outcome.instructions))).toEqual([]);
    expect(outcome.instructions).toContain(
      "The org is the caller's own: list_playbooks shows its playbooks. get_guide explains these words",
    );
    expect(outcome.listed.structuredContent).toMatchObject({ playbooks: [{ id: 'alpha' }, { id: 'beta' }] });
  });
});

describe.each(mcpClientKinds)('the %s client on /mcp', (kind) => {
  it('lists the thirty tools and the playbooks of its org', async () => {
    const outcome = await asKey(
      acmeAdmin.key,
      async (session) => ({
        protocolVersion: session.protocolVersion,
        tools: toolNamesIn(await session.listTools()).length,
        playbooks: await session.callTool('list_playbooks', {}),
      }),
      kind,
    );

    expect(outcome.tools).toBe(30);
    expect(outcome.playbooks.structuredContent).toMatchObject({ playbooks: [{ id: 'alpha' }, { id: 'beta' }] });
  });
});

async function toolsListedUnder(revision: string): Promise<readonly string[]> {
  const answer = await fetch(`${server.origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${acmeAdmin.key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': revision,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const data = (await answer.text()).split('\n').filter((line) => line.startsWith('data: '));
  return data.flatMap((line) => toolNamesIn(listResultOf(line.slice('data: '.length)).result));
}

describe('the earlier revisions on /mcp', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])(
    'list the same tools under %s',
    async (revision) => {
      const current = await asKey(acmeAdmin.key, async (session) => toolNamesIn(await session.listTools()));

      expect(await toolsListedUnder(revision)).toEqual(current);
    },
  );
});
