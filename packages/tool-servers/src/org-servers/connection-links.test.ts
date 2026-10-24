import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { describedAccess, reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeApi, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function connectedTo(fake: FakeMcpServer, org = 'acme') {
  const connections = fakeConnections();
  connections.connect(org, {
    id: 'graph-id',
    name: 'graph',
    entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
    environment: { GRAPH_API_KEY: fakeApiKey },
  });
  const { access } = reportingAccess({}, { timing: patientTiming, connections });
  closing.push(access.close);
  return { access, connections };
}

const unforeseen = 'The registry answered something the runtime does not read';

const listedTools: unknown = expect.any(Array);

function unforeseenAtTheBase(url: string): string | undefined {
  if (new URL(url).pathname.startsWith('/v1')) {
    throw new Error(unforeseen);
  }
  return undefined;
}

function searchOf(server: string) {
  return { ...alpha, reference: { server, tool: 'search' }, input: { query: 'acme' }, meta: {} };
}

describe('a connection checked by name and removed before any link was made to it', () => {
  it('is forgotten at the next listing, and never reached', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);
    await Effect.runPromise(access.named(alpha, [{ server: 'graph', tool: 'search' }]));

    connections.remove('graph-id');

    expect(await Effect.runPromise(access.listServers(alpha))).toEqual([]);
    expect([connections.credentialReads(), fake.seen()]).toEqual([1, []]);
  });
});

describe('a connection of another org', () => {
  it('serves none of the playbooks of this one, and is never reached from it', async () => {
    const fake = await fakeServer();
    const { access } = connectedTo(fake, 'globex');

    const refused = await Effect.runPromise(Effect.flip(access.named(alpha, [{ server: 'graph', tool: 'search' }])));

    expect(refused).toMatchObject({ because: 'tool_server_not_configured' });
    expect(await Effect.runPromise(access.listServers(alpha))).toEqual([]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('the links of connections when the access closes', () => {
  it('are stopped, ending the session a run held', async () => {
    const fake = await fakeServer();
    const { access } = connectedTo(fake);
    await Effect.runPromise(access.listServers(alpha));
    await Effect.runPromise(
      access.callOnce({ ...alpha, reference: { server: 'graph', tool: 'search' }, input: { query: 'acme' }, meta: {} }),
    );

    await access.close();

    expect(fake.openSessions()).toBe(0);
  });
});

describe('a connection whose preparation fails for a reason the runtime did not foresee', () => {
  it('is listed failing in the words of the failure beside the others, and is prepared again at the next use', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);
    connections.connect('acme', {
      id: 'wiki-id',
      name: 'wiki',
      entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
      environment: { GRAPH_API_KEY: fakeApiKey },
    });
    connections.dieOnceWhilePreparing('graph-id', unforeseen);

    const failing = await Effect.runPromise(access.listServers(alpha));
    const prepared = await Effect.runPromise(access.listServers(alpha));

    expect(failing).toMatchObject([
      { name: 'graph', because: 'failing', unavailable: `The tool server graph could not be used: ${unforeseen}` },
      { name: 'wiki', tools: listedTools },
    ]);
    expect(prepared).toMatchObject([{ name: 'graph', tools: listedTools }, { name: 'wiki' }]);
    expect(connections.credentialReads()).toBe(3);
  });
});

describe('a connection whose link fails for a reason the runtime did not foresee', () => {
  it('is listed failing in the words of the failure, and its link is made again at the next use', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const connections = fakeConnections();
    connections.connect('acme', {
      id: 'graph-id',
      name: 'graph',
      entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } },
      environment: { GRAPH_API_KEY: fakeApiKey },
      reaches: unforeseenAtTheBase,
    });
    const { access } = await describedAccess({}, { timing: patientTiming, connections });
    closing.push(access.close);

    const [first] = await Effect.runPromise(access.listServers(alpha));
    const [second] = await Effect.runPromise(access.listServers(alpha));

    expect([first, second]).toMatchObject([
      { name: 'graph', because: 'failing', unavailable: `The tool server graph could not be used: ${unforeseen}` },
      { name: 'graph', because: 'failing' },
    ]);
    expect([connections.credentialReads(), fake.documentReads(), fake.seen()]).toEqual([1, 2, []]);
  });
});

describe('an operation over the tools of an org', () => {
  it('reads the connections of the org once, to record the start of a call and make it, or to check and list a tool', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);

    const prepared = await Effect.runPromise(access.preparedCall(searchOf('graph')));
    const called = await Effect.runPromise(prepared.called);
    const afterTheCall = connections.orgReads();
    const { naming, listed } = await Effect.runPromise(access.lookUp(alpha, { server: 'graph', tool: 'search' }));
    const server = await Effect.runPromise(listed);

    expect([prepared.fields, called, naming, server]).toMatchObject([
      { server: 'graph', connection_id: 'graph-id', tool: 'search' },
      { kind: 'answered', outcome: 'result' },
      { _tag: 'Success' },
      { name: 'graph', tools: listedTools },
    ]);
    expect([afterTheCall, connections.orgReads(), connections.credentialReads()]).toEqual([1, 2, 1]);
  });
});

describe('a connection named as a server the configuration sets up for another org', () => {
  it('is listed as not used in the words of the configuration, and a call naming it reaches neither server', async () => {
    const fake = await fakeServer();
    const connections = fakeConnections();
    const entry = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } };
    const environment = { GRAPH_API_KEY: fakeApiKey };
    connections.connect('acme', { id: 'graph-id', name: 'graph', entry, environment });
    const { access } = reportingAccess(
      { graph: { ...entry, org: 'globex' } },
      { environment, timing: patientTiming, connections },
    );
    closing.push(access.close);

    const listed = await Effect.runPromise(access.listServers(alpha));
    const called = await Effect.runPromise(access.callOnce(searchOf('graph')));

    expect(listed).toMatchObject([
      {
        name: 'graph',
        connection: 'graph-id',
        because: 'connection_not_allowed',
        unavailable:
          "The runtime's configuration sets up a tool server named graph, so a connection cannot take that name; remove it and add it again under another name",
      },
    ]);
    expect(called).toMatchObject({ kind: 'unopened', refused: 'tool_not_offered', because: 'connection_not_allowed' });
    expect([fake.seen(), connections.credentialReads()]).toEqual([[], 0]);
  });
});

describe('a connection whose credential cannot be read, and whose break could not be recorded', () => {
  it('is refused broken, and read again at the next use, once within each use', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);
    connections.loseTheCredentialUnrecordedOf('graph-id', unforeseen);

    const first = await Effect.runPromise(access.listServers(alpha));
    const prepared = await Effect.runPromise(access.preparedCall(searchOf('graph')));
    const called = await Effect.runPromise(prepared.called);

    expect(first).toMatchObject([{ name: 'graph', because: 'connection_broken', unavailable: unforeseen }]);
    expect(called).toMatchObject({ kind: 'unopened', refused: 'tool_not_offered', because: 'connection_broken' });
    expect([connections.credentialReads(), fake.seen()]).toEqual([2, []]);
  });
});

describe('a connection whose credential cannot be read now', () => {
  it('is refused unavailable in the words of its source and still listed, and is prepared again at each use until it is served', async () => {
    const fake = await fakeServer();
    const { access, connections } = connectedTo(fake);
    const withheld = 'The credential of the connection graph cannot be read now: the key is disabled';
    connections.withholdTheCredentialOf('graph-id', withheld);

    const listed = await Effect.runPromise(access.listServers(alpha));
    const refused = await Effect.runPromise(access.callOnce(searchOf('graph')));
    connections.connect('acme', {
      id: 'graph-id',
      name: 'graph',
      entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
      environment: { GRAPH_API_KEY: fakeApiKey },
    });
    const called = await Effect.runPromise(access.callOnce(searchOf('graph')));

    expect(listed).toMatchObject([{ name: 'graph', because: 'connection_unavailable', unavailable: withheld }]);
    expect(refused).toMatchObject({ kind: 'unopened', refused: 'tool_not_offered', because: 'connection_unavailable' });
    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(connections.credentialReads()).toBe(3);
  });
});
