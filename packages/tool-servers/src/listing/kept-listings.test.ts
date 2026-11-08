import { CallFetch } from '@on.auto/operations';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionSource } from '../org-servers/connection-source.ts';
import { fakeConnections, type FakeConnection, type FakeConnections } from '../testing/fake-connections.ts';
import { reportingAccess, type AccessOptions } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';
import { LISTING_KEPT_MS } from './kept-listings.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const environment = { GRAPH_API_KEY: apiKey };

const inAcme = { org: 'acme', playbook: undefined };

const inGlobex = { org: 'globex', playbook: undefined };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...changes };
}

function graphOn(fake: FakeMcpServer, id = 'graph-id'): FakeConnection {
  return { id, name: 'graph', environment, entry: remote(fake, { allowed: ['echo', 'search'] }) };
}

function accessTo(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}) {
  const { access } = reportingAccess(servers, { now: () => 0, ...options, environment });
  closing.push(access.close);
  return access;
}

function listingsAsked(fake: FakeMcpServer): number {
  return fake.seen().filter(({ rpc }) => rpc === 'tools/list').length;
}

function servingNow(connections: FakeConnections, playbooks: () => readonly string[]): ConnectionSource {
  return {
    takesConnections: true,
    connectionsOf: (org) =>
      Effect.map(connections.connectionsOf(org), (listed) =>
        listed.map((connection) => ({ ...connection, serving: { ...connection.serving, playbooks: playbooks() } })),
      ),
  };
}

function aFetchOfItsOwn(): typeof globalThis.fetch {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    globalThis.fetch(String(address), Object.assign({}, init));
}

describe('the servers of an org listed again within five minutes', () => {
  it('are answered from what was listed, asking the server nothing, and listed anew once five minutes passed', async () => {
    const fake = await fakeServer();
    const clock = { now: Date.parse('2026-11-08T12:00:00.000Z') };
    const access = accessTo({ graph: remote(fake, { allowed: ['echo'] }) }, { now: () => clock.now });

    const first = await Effect.runPromise(access.listServersInOrg(inAcme));
    const asked = { first: listingsAsked(fake), sessions: fake.openSessions() };
    clock.now += LISTING_KEPT_MS - 1;
    const kept = await Effect.runPromise(access.listServersInOrg(inAcme));
    const askedWhileKept = { listings: listingsAsked(fake), sessions: fake.openSessions() };
    clock.now += 1;
    const anew = await Effect.runPromise(access.listServersInOrg(inAcme));

    expect(first.servers).toMatchObject([{ name: 'graph', tools: [{ name: 'echo' }] }]);
    expect([kept, anew]).toEqual([first, first]);
    expect([asked.first, askedWhileKept.listings, listingsAsked(fake)]).toEqual([1, 1, 2]);
    expect(askedWhileKept.sessions).toBe(asked.sessions);
  });

  it('are kept for that org alone: a server two orgs share is listed once for each', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake, { org: '*', allowed: ['echo'] }) });

    await Effect.runPromise(access.listServersInOrg(inAcme));
    await Effect.runPromise(access.listServersInOrg(inGlobex));
    await Effect.runPromise(access.listServersInOrg(inAcme));
    await Effect.runPromise(access.listServersInOrg(inGlobex));

    expect(listingsAsked(fake)).toBe(2);
  });

  it('are kept across calls that each send their requests through a fetch of their own', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake, { allowed: ['echo'] }) });
    const ofACall = () => access.listServersInOrg(inAcme).pipe(Effect.provideService(CallFetch, aFetchOfItsOwn()));

    await Effect.runPromise(ofACall());
    const second = await Effect.runPromise(ofACall());

    expect(second.servers).toMatchObject([{ name: 'graph', tools: [{ name: 'echo' }] }]);
    expect(listingsAsked(fake)).toBe(1);
  });
});

describe('a server of an org that could not be listed', () => {
  it('is kept as nothing, so the next listing asks it again', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake, { allowed: ['echo'] }) });
    fake.answerNextOf('tools/list', 500);

    const failed = await Effect.runPromise(access.listServersInOrg(inAcme));
    const listed = await Effect.runPromise(access.listServersInOrg(inAcme));
    await Effect.runPromise(access.listServersInOrg(inAcme));

    expect(failed.servers).toMatchObject([{ name: 'graph', because: 'failing' }]);
    expect(listed.servers).toMatchObject([{ name: 'graph', tools: [{ name: 'echo' }] }]);
    expect(listingsAsked(fake)).toBe(2);
  });
});

describe('a connection of an org whose tools were listed', () => {
  it('is listed anew once it is connected again, since its credential may have changed', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', graphOn(fake));
    const access = accessTo({}, { connections });

    await Effect.runPromise(access.listServersInOrg(inAcme));
    await Effect.runPromise(access.listServersInOrg(inAcme));
    connections.connect('acme', graphOn(fake));
    const again = await Effect.runPromise(access.listServersInOrg(inAcme));

    expect(listingsAsked(fake)).toBe(2);
    expect(again.servers).toMatchObject([{ name: 'graph', connection: 'graph-id', tools: [{}, {}] }]);
  });

  it('is left out once removed, and one added in its name is listed anew', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', graphOn(fake));
    const access = accessTo({}, { connections });

    await Effect.runPromise(access.listServersInOrg(inAcme));
    connections.remove('graph-id');
    const removed = await Effect.runPromise(access.listServersInOrg(inAcme));
    connections.connect('acme', graphOn(fake, 'graph-again'));
    const added = await Effect.runPromise(access.listServersInOrg(inAcme));

    expect(removed).toEqual({ servers: [], settings: [] });
    expect(added.servers).toMatchObject([{ name: 'graph', connection: 'graph-again' }]);
    expect(listingsAsked(fake)).toBe(2);
  });
});

describe('the playbooks a kept connection serves', () => {
  it('are read as they are now, and decide whether it is listed for a playbook, its tools kept', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    connections.connect('acme', graphOn(fake));
    const playbooks = { now: ['alpha'] };
    const access = accessTo({}, { connections: servingNow(connections, () => playbooks.now) });

    const before = await Effect.runPromise(access.listServersInOrg(inAcme));
    const forBetaBefore = await Effect.runPromise(access.listServersInOrg({ org: 'acme', playbook: 'beta' }));
    playbooks.now = ['alpha', 'beta'];
    const forBeta = await Effect.runPromise(access.listServersInOrg({ org: 'acme', playbook: 'beta' }));

    expect(before.servers).toMatchObject([{ name: 'graph', playbooks: ['alpha'] }]);
    expect(forBetaBefore.servers).toEqual([]);
    expect(forBeta.servers).toEqual([{ ...before.servers[0], playbooks: ['alpha', 'beta'] }]);
    expect(listingsAsked(fake)).toBe(1);
  });
});

describe('the servers a playbook may use', () => {
  it('are listed each time they are asked for, as a run reads what its servers list now', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake, { allowed: ['echo'] }) });

    await Effect.runPromise(access.listServersInOrg(inAcme));
    await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));
    await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listingsAsked(fake)).toBe(3);
  });
});
