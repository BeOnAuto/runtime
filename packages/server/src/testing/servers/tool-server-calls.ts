import type { McpSession, ToolResult } from '@on.auto/api/testing';
import { accountFake, accountServerOver, testSigners } from '@on.auto/meter/testing';
import type { ScriptedReplies } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';

import { linkIn } from './connected-servers.ts';
import { servingReasoning, type ReasoningServer } from './reasoning-server.ts';

const toolServerKey = 'graph-api-key-4f1d9a7c2b';

type InPlaybook = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;

export interface ToolServing extends ReasoningServer {
  readonly licenseKey: string;
}

export async function servingWithAToolServer(replies: readonly ScriptedReplies[]): Promise<ToolServing> {
  const graph = await serveFakeMcp({ bearer: toolServerKey });
  const account = accountFake();
  const accounts = await accountServerOver(account);
  const environment = {
    GRAPH_API_KEY: toolServerKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'local' },
    }),
    ACCOUNTS_ORIGIN: accounts.origin,
  };
  const server = await servingReasoning(replies, environment, undefined, { signers: testSigners });
  return {
    ...server,
    licenseKey: account.keyFor('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'),
    stop: async () => {
      await server.stop();
      await graph.close();
      await accounts.close();
    },
  };
}

export async function licenseActivated(
  session: McpSession,
  { licenseKey }: Pick<ToolServing, 'licenseKey'>,
): Promise<readonly (readonly [string, ToolResult])[]> {
  return [['activate_license', await session.callTool('activate_license', { key: licenseKey })]];
}

export async function toolServerToolsCalled(
  session: McpSession,
  inPlaybook: InPlaybook,
  server: Pick<ReasoningServer, 'call'>,
): Promise<readonly (readonly [string, ToolResult])[]> {
  const asked = { server: 'graph', tool: 'search' };
  const searchedFor = { ...asked, arguments: { query: 'acme' } };
  const crmServer = await serveFakeMcp();
  const crm = { name: 'crm', type: 'mcp', entry: { url: crmServer.url }, credential: { kind: 'none' } };
  const added = await session.callTool('add_connection', crm);
  const { id, token } = linkIn(added.structuredContent);
  await server.call('POST', `/v1/orgs/local/connections/${id}/approve`, { body: { token } });
  const toolsListed = await session.callTool('list_connection_tools', { id });
  await crmServer.close();
  return [
    ['add_connection', added],
    ['list_connection_tools', toolsListed],
    ['list_connections', await session.callTool('list_connections', {})],
    ['reconnect_connection', await session.callTool('reconnect_connection', { id })],
    ['remove_connection', await session.callTool('remove_connection', { id })],
    ['search', await session.callTool('search', inPlaybook({ terms: 'rows' }))],
    ['introspect', await session.callTool('introspect', inPlaybook(asked))],
    ['dry_run', await session.callTool('dry_run', inPlaybook(searchedFor))],
    ['execute', await session.callTool('execute', inPlaybook(searchedFor))],
  ];
}
