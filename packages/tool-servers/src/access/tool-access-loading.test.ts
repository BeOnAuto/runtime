import { join } from 'node:path';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections } from '../testing/fake-connections.ts';
import { fakeMcpInProcess, noToolServers, reportingAccess } from '../testing/index.ts';
import type { FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function fakeServer(): FakeMcpServer {
  const fake = fakeMcpInProcess({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

describe('an access to tool servers', () => {
  it('opens nothing until a run opens its tools, so an access closed unused has reached no server', async () => {
    const fake = fakeServer();
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: apiKey } },
    );

    await access.close();

    expect(access.configured).toBe(true);
    expect(fake.seen()).toEqual([]);
  });
});

describe('the modules an access loads when it is first used', () => {
  it('reach child processes through the transport of a stdio server alone, which the access imports when it first opens one', () => {
    const source = join(import.meta.dirname, '..');

    expect(modulesReachedFrom(source, 'access/linked-access.ts').packages).not.toContain('node:child_process');
    expect(modulesReachedFrom(source, 'clients/stdio-client.ts').packages).toContain('node:child_process');
  });
});

const loadedOnFirstUse = [
  'clients/http-client.ts',
  'clients/mcp-client.ts',
  'clients/token-source.ts',
  'clients/link-openers.ts',
  'openapi/api-client.ts',
  'declared-requests/bearer-requests.ts',
  'declared-requests/carried-credentials.ts',
  'declared-requests/requested-answers.ts',
];

describe('the modules an access loads when it is made', () => {
  it('hold no client, token source or code that sends a request an entry declares, which load on first use', () => {
    const source = join(import.meta.dirname, '..');
    const reached = new Set(
      ['access/tool-access.ts', 'index.ts'].flatMap((entry) => modulesReachedFrom(source, entry).files),
    );

    expect(loadedOnFirstUse.filter((file) => reached.has(file))).toEqual([]);
    expect(modulesReachedFrom(source, 'access/linked-access.ts').files).toEqual(
      expect.arrayContaining(loadedOnFirstUse.slice(0, 5)),
    );
    expect(modulesReachedFrom(source, 'declared-requests/bearer-requests.ts').files).toEqual(
      expect.arrayContaining(loadedOnFirstUse),
    );
  });
});

describe('an access to the tool servers of connections alone', () => {
  it('may reach outside where people may add connections, and not where nothing serves a playbook', async () => {
    const { access } = reportingAccess({}, { connections: fakeConnections() });

    await access.close();

    expect([access.configured, noToolServers.configured]).toEqual([true, false]);
  });
});
