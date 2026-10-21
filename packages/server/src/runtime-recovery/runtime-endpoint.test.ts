import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { parseJSONRPCMessage } from '@modelcontextprotocol/server';
import { hearingFetch } from '@on.auto/api';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servingWorkflows } from '../testing/servers/workflow-server.ts';
import { pingOf } from './runtime-connection.ts';

async function servedPort(environment: Readonly<Record<string, string>> = {}): Promise<number> {
  const server = await servingWorkflows([], environment);
  onTestFinished(async () => {
    await server.stop();
  });
  return Number(new URL(server.origin).port);
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'an-agent', version: '1.0.0' } },
};

describe("the runtime's own MCP endpoint, served in process", () => {
  it("answers the relay's ping", async () => {
    const port = await servedPort();

    await expect(Effect.runPromise(pingOf(port))).resolves.toBe('answers');
  });

  it('asks the ping for a credential when it was started with API keys', async () => {
    const key = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });
    const port = await servedPort({ API_KEYS: JSON.stringify([key.entry]) });

    await expect(Effect.runPromise(pingOf(port))).resolves.toBe('asks for a credential');
  });

  it('streams an answer with no event id, so the relay never has a stream to resume', async () => {
    const port = await servedPort();
    const decoder = new TextDecoder();
    const said = { text: '' };
    const answered = Promise.withResolvers<unknown>();
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      fetch: hearingFetch(fetch, () => ({
        piece: (piece) => {
          said.text += decoder.decode(piece, { stream: true });
        },
        ended: Function.constVoid,
      })),
    });
    Object.assign(transport, { onmessage: answered.resolve });
    await transport.start();

    await transport.send(parseJSONRPCMessage(initialize));

    await expect(answered.promise).resolves.toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } });
    expect(said.text).toMatch(/^event: message$/mu);
    expect(said.text).not.toMatch(/^id:/mu);
    await transport.close();
  });
});
