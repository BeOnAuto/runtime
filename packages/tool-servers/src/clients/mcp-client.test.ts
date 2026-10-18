import { describe, expect, it, onTestFinished } from 'vitest';

import type { McpServerSettings } from '../settings/server-settings.ts';
import { serveFakeMcp, testClientInfo } from '../testing/index.ts';
import { openHttp, systemTimer, type HttpOpening } from './http-client.ts';

function httpSettings(url: string): McpServerSettings {
  return {
    type: 'mcp',
    name: 'graph',
    url,
    headers: new Map(),
    auth: null,
    orgs: ['acme'],
    playbooks: null,
    allowed: null,
    record_content: false,
    request_id: null,
    secrets: [],
    connection: null,
  };
}

function opening(reportError: (message: string) => void): HttpOpening {
  return {
    clientInfo: testClientInfo,
    fetch: globalThis.fetch,
    authProvider: undefined,
    timeoutMs: 5000,
    longestRetryWaitMs: 1000,
    reportError,
    timer: systemTimer,
  };
}

describe('a client of an MCP server', () => {
  it('tells the server it is the client it was given, by name and version', async () => {
    const fake = await serveFakeMcp();
    onTestFinished(fake.close);
    const reported: string[] = [];

    const client = await openHttp(
      httpSettings(fake.url),
      opening((message) => {
        reported.push(message);
      }),
    );
    await client.end();
    const initializing = fake.seen().filter(({ rpc }) => rpc === 'initialize');

    expect(initializing.map(({ clientInfo }) => clientInfo)).toEqual([
      { name: '@on.auto/runtime', version: '0.0.0-test' },
    ]);
    expect(reported).toEqual([]);
  });
});
