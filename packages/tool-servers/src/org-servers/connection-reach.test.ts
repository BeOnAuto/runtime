import { HostUnresolved } from '@on.auto/outbound';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections, type FakeConnection } from '../testing/fake-connections.ts';
import { type FakeMcpOptions, type FakeMcpServer } from '../testing/index.ts';
import { patientTiming } from '../testing/index.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { serveFakeApi, serveFakeMcp } from '../testing/served-fakes.ts';
import { fakeApiKey } from '../testing/served-fakes.ts';
import type { ConnectionServer } from './connection-source.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const clientSecret = 'graph-client-secret-81c2';

const environment = { GRAPH_API_KEY: fakeApiKey, GRAPH_CLIENT_SECRET: clientSecret };

const outsideTheRule =
  'A connection may not reach the host api.billing.example.org on this runtime, which allows *.example.com';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp(options);
  closing.push(fake.close);
  return fake;
}

async function accessThrough(connection: Omit<FakeConnection, 'id' | 'name' | 'environment'>) {
  const connections = fakeConnections();
  connections.connect('acme', { id: 'graph-id', name: 'graph', environment, ...connection });
  const { access } = await describedAccess({}, { environment, timing: patientTiming, connections });
  closing.push(access.close);
  return access;
}

function refusing(path: string): ConnectionServer['reaches'] {
  return (url) => (new URL(url).pathname.startsWith(path) ? outsideTheRule : undefined);
}

function unresolvedAt(path: string): ConnectionServer['reaches'] {
  return (url) =>
    new URL(url).pathname.startsWith(path) ? Promise.reject(new HostUnresolved({ host: 'api' })) : undefined;
}

describe('a connection to an HTTP API whose document names where its calls go', () => {
  it('is not allowed once its document is read, when the rules do not allow that address, and no call is sent', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const access = await accessThrough({
      entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
      reaches: refusing('/v1'),
    });

    expect(await Effect.runPromise(access.listServers(alpha))).toMatchObject([
      { name: 'graph', because: 'connection_not_allowed', unavailable: outsideTheRule },
    ]);
    expect(
      await Effect.runPromise(
        access.callOnce({ ...alpha, reference: { server: 'graph', tool: 'search' }, input: {}, meta: {} }),
      ),
    ).toMatchObject({ kind: 'unopened', refused: 'tool_not_offered', because: 'connection_not_allowed' });
    expect([fake.documentReads(), fake.seen()]).toEqual([1, []]);
  });
});

describe('a connection to an HTTP API whose base address cannot be looked up', () => {
  it('is listed unreachable, to try again, not refused by the rules', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const access = await accessThrough({
      entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
      reaches: unresolvedAt('/v1'),
    });

    expect(await Effect.runPromise(access.listServers(alpha))).toMatchObject([
      { name: 'graph', because: 'unreachable' },
    ]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('a connection whose authorization server the rules do not allow', () => {
  it('asks it for no token, and lists the connection unavailable in the words of the rule', async () => {
    const fake = await fakeServer({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
    const auth = { issuer: fake.origin, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };
    const access = await accessThrough({ entry: { url: fake.url, auth }, reaches: refusing('/token') });

    const [listed] = await Effect.runPromise(access.listServers(alpha));

    expect(listed).toMatchObject({ name: 'graph', because: 'connection_not_allowed', unavailable: outsideTheRule });
    expect(fake.tokenRequests()).toBe(0);
  });
});

describe('a connection to a server that answers with a redirect', () => {
  it('follows none to another origin, nor one within its origin to an address the rules do not allow', async () => {
    const elsewhere = await fakeServer();
    const fake = await fakeServer();
    fake.answerNextWith(307, 1, { location: elsewhere.url });
    const access = await accessThrough({ entry: { url: fake.url }, reaches: refusing('/elsewhere') });
    const [across] = await Effect.runPromise(access.listServers(alpha));
    fake.answerNextWith(307, 1, { location: `${fake.origin}/elsewhere/mcp` });

    const [within] = await Effect.runPromise(access.listServers(alpha));

    expect([across, within]).toMatchObject([
      { name: 'graph', because: 'failing' },
      { name: 'graph', because: 'connection_not_allowed', unavailable: outsideTheRule },
    ]);
    expect([elsewhere.seen().length, fake.seen().length]).toEqual([0, 2]);
  });
});
