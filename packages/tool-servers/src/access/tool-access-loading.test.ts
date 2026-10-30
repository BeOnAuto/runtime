import { join } from 'node:path';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections } from '../testing/fake-connections.ts';
import { noToolServers, reportingAccess } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

describe('an access to tool servers', () => {
  it('opens nothing until a run opens its tools, so an access closed unused has reached no server', async () => {
    const fake = await fakeServer();
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

describe('an access to the tool servers of connections alone', () => {
  it('may reach outside where people may add connections, and not where nothing serves a playbook', async () => {
    const { access } = reportingAccess({}, { connections: fakeConnections() });

    await access.close();

    expect([access.configured, noToolServers.configured]).toEqual([true, false]);
  });
});
