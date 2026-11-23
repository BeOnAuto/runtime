import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeConnections, serverThroughOf } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { closedAfter, oneCallKey, oneCallServer, unopenedWith } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { keptNowhere } from './one-call.ts';

function throughTheFake(url: string, key: string) {
  return serverThroughOf('acme', {
    id: 'graph-id',
    name: 'graph',
    entry: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
    environment: { GRAPH_API_KEY: key },
  });
}

describe('one read through a server not kept', () => {
  it('calls a tool that only reads, with no arguments, under the credential the server places', async () => {
    const fake = oneCallServer();
    const { access } = reportingAccess({}, { timing: patientTiming });
    closedAfter(access.close);
    const read = (tool: string, key: string) =>
      Effect.runPromise(
        access.readOnceThrough(
          { org: 'acme', reference: { server: 'graph', tool }, meta: {} },
          throughTheFake(fake.url, key),
        ),
      );

    const reads = await Promise.all([
      read('profile', oneCallKey),
      read('echo', oneCallKey),
      read('profile', 'graph-api-key-0000000000'),
    ]);

    expect(reads).toMatchObject([
      { kind: 'answered', outcome: 'result' },
      { kind: 'unopened', refused: 'tool_not_read_only' },
      { kind: 'unopened', because: 'connection_broken' },
    ]);
    expect(fake.received()).toEqual([{ tool: 'profile', arguments: {}, meta: {} }]);
  });

  it('keeps no content, so a keeping asked of it is refused', async () => {
    await expect(keptNowhere('{}')).rejects.toThrow(Error);
  });
});

const graphEntry = (url: string) => ({ url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } });

function connectedAsGraph(changes: Readonly<Record<string, unknown>> = {}, mostRequestBytes?: number) {
  const fake = oneCallServer();
  const connections = fakeConnections();
  const environment = { GRAPH_API_KEY: oneCallKey };
  connections.connect('acme', {
    id: 'graph-id',
    name: 'graph',
    entry: { ...graphEntry(fake.url), ...changes },
    environment,
  });
  connections.connect('globex', { id: 'other-id', name: 'graph', entry: graphEntry(fake.url), environment });
  connections.pend('acme', { id: 'crm-id', name: 'crm', entry: graphEntry(fake.url), environment });
  const { access } = reportingAccess(
    { files: { ...graphEntry(fake.url), org: 'acme' } },
    {
      environment,
      timing: patientTiming,
      connections,
      ...(mostRequestBytes === undefined ? {} : { mostRequestBytes }),
    },
  );
  closedAfter(access.close);
  const asTheConnection = (connection: string) =>
    Effect.runPromise(access.callAsTheConnection({ org: 'acme', connection, tool: 'echo', input: { text: 'Hi' } }));
  return { fake, access, asTheConnection };
}

describe('one call as a connection of the organization, made as no playbook', () => {
  it('calls the tool through the connection whichever playbooks may use it, and keeps nothing though the connection keeps content', async () => {
    const { fake, access, asTheConnection } = connectedAsGraph({ playbooks: ['beta'], record_content: true });
    const asAPlaybook = (playbook: string) =>
      Effect.runPromise(
        access.callOnce({ org: 'acme', playbook, reference: { server: 'graph', tool: 'echo' }, input: {}, meta: {} }),
      );

    expect([await asTheConnection('graph-id'), await asAPlaybook('alpha')]).toMatchObject([
      { kind: 'answered', outcome: 'result' },
      { kind: 'unopened', refused: 'tool_not_offered', because: 'tool_server_not_configured' },
    ]);
    expect(fake.received()).toEqual([{ tool: 'echo', arguments: { text: 'Hi' }, meta: {} }]);
  });

  it.each([
    ['another organization’s connection', 'other-id'],
    ['a tool server of the configuration, which is no connection', 'files'],
  ] as const)('reaches no service through %s', async (_, connection) => {
    const { fake, asTheConnection } = connectedAsGraph();

    expect(await asTheConnection(connection)).toBeUndefined();
    expect(fake.received()).toEqual([]);
  });

  it('is refused a connection nobody approved yet, a tool the operator does not allow, and arguments larger than the server takes', async () => {
    const pending = connectedAsGraph();
    const allowing = connectedAsGraph({ allowed: ['profile'] });
    const bounded = connectedAsGraph({}, 2);

    expect([
      await pending.asTheConnection('crm-id'),
      await allowing.asTheConnection('graph-id'),
      await bounded.asTheConnection('graph-id'),
    ]).toMatchObject([
      unopenedWith('tool_not_offered', 'connection_pending', expect.any(String)),
      unopenedWith('tool_not_offered', 'tool_not_allowed', expect.any(String)),
      unopenedWith('asset_not_sent', 'too_large', expect.any(String)),
    ]);
    expect([pending.fake.received(), allowing.fake.received(), bounded.fake.received()]).toEqual([[], [], []]);
  });
});
