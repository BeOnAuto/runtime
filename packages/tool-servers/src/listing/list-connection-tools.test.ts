import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineListConnectionTools } from '../index.ts';
import { fakeConnections, pendingWords, type FakeConnections } from '../testing/fake-connections.ts';
import { patientTiming, verboseDescription } from '../testing/index.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeApi, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const reader: CallerIdentity = {
  id: 'acme-reader',
  name: 'acme-reader',
  org: 'acme',
  permissions: ['org:read'],
  playbooks: '*',
};

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

const environment = { GRAPH_API_KEY: fakeApiKey };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function listingOver(connections: FakeConnections) {
  const { access } = await describedAccess({}, { environment, timing: patientTiming, connections });
  closing.push(access.close);
  const { registration } = defineListConnectionTools(access);
  return {
    registration,
    listed: (input: unknown): Promise<Outcome> =>
      Effect.runPromise(
        makeDispatcher([])
          .dispatchToOrg(registration, { caller: reader, org: 'acme', input, encoding: 'strings' })
          .pipe(Effect.provide(services)),
      ),
  };
}

async function fakeMcp(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  return fake;
}

function graphOn(fake: FakeMcpServer, allowed: readonly string[]) {
  return {
    id: 'graph-id',
    name: 'graph',
    environment,
    entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, allowed },
  };
}

async function connectedGraph(allowed: readonly string[]) {
  const connections = fakeConnections();
  connections.connect('acme', graphOn(await fakeMcp(), allowed));
  return listingOver(connections);
}

const PageSchema = Schema.Struct({
  output: Schema.Struct({ next_cursor: Schema.NullOr(Schema.String) }),
});

const anyCursor: unknown = expect.any(String);

describe('list_connection_tools', () => {
  it('is a query of the org at GET /connections/{id}/tools that reaches outside the runtime', async () => {
    const { registration } = await listingOver(fakeConnections());

    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_connection_tools',
      route: { method: 'GET', path: '/connections/{id}/tools' },
      permissions: ['org:read'],
      reachesOutside: true,
      mayChangeOutside: false,
    });
  });
});

describe('the tools of a connection', () => {
  it('are those its server offers now and its entry allows, by name, each with its title, its whole description and its hints', async () => {
    const { listed } = await connectedGraph(['search', 'verbose', 'environment', 'exit', 'echo']);

    expect(await listed({ id: 'graph-id' })).toEqual({
      status: 'succeeded',
      output: {
        connection: 'graph-id',
        server: 'graph',
        tools: [
          { name: 'echo', description: 'Answers with its arguments.' },
          {
            name: 'environment',
            title: 'Environment',
            description: 'Answers with the names of the environment variables of the server.',
          },
          { name: 'exit', description: 'Ends the server while it is called.', destructive: true },
          {
            name: 'search',
            description: 'Finds the rows of the graph that match a query.',
            read_only: true,
            open_world: true,
          },
          { name: 'verbose', title: 'Verbose', description: verboseDescription.slice(0, 4096) },
        ],
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('the pages of the tools of a connection', () => {
  it('are read a page at a time, the cursor of one page reading on after its last tool', async () => {
    const { listed } = await connectedGraph(['search', 'verbose', 'environment', 'exit', 'echo']);

    const first = await listed({ id: 'graph-id', limit: '2' });
    const { next_cursor: cursor } = Schema.decodeUnknownSync(PageSchema)(first).output;
    const second = await listed({ id: 'graph-id', limit: '2', cursor });
    const { next_cursor: last } = Schema.decodeUnknownSync(PageSchema)(second).output;

    expect(first).toMatchObject({
      output: { tools: [{ name: 'echo' }, { name: 'environment' }], has_more: true, next_cursor: anyCursor },
    });
    expect(second).toMatchObject({ output: { tools: [{ name: 'exit' }, { name: 'search' }], has_more: true } });
    expect(await listed({ id: 'graph-id', limit: '2', cursor: last })).toMatchObject({
      output: { tools: [{ name: 'verbose' }], has_more: false, next_cursor: null },
    });
  });

  it('refuse a cursor no page gave', async () => {
    const { listed } = await connectedGraph(['echo']);

    expect(await listed({ id: 'graph-id', cursor: 'not-a-cursor' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/cursor', detail: 'Expected the next_cursor of a page of list_connection_tools' }],
    });
  });
});

describe('the tools of a connection to an HTTP API', () => {
  it('are the operations of its document, those that only read marked read-only', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    closing.push(fake.close);
    const connections = fakeConnections();
    connections.connect('acme', {
      id: 'graph-id',
      name: 'graph',
      environment,
      entry: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, allowed: ['search', 'echo'] },
    });
    const { listed } = await listingOver(connections);

    expect(await listed({ id: 'graph-id' })).toMatchObject({
      status: 'succeeded',
      output: {
        tools: [
          { name: 'echo', description: 'Answers with its arguments.', open_world: true },
          { name: 'search', read_only: true, idempotent: true, open_world: true },
        ],
      },
    });
  });
});

describe('the tools of a connection that cannot answer them', () => {
  it('are refused as unavailable, in the words of why, for a connection nobody approved yet', async () => {
    const connections = fakeConnections();
    connections.pend('acme', graphOn(await fakeMcp(), ['echo']));
    const { listed } = await listingOver(connections);

    expect(await listed({ id: 'graph-id' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'connection_pending',
      detail: pendingWords('graph'),
    });
  });

  it('are not found for a connection the org does not have, or has removed', async () => {
    const connections = fakeConnections();
    connections.connect('acme', graphOn(await fakeMcp(), ['echo']));
    connections.remove('graph-id');
    const { listed } = await listingOver(connections);

    expect(await listed({ id: 'graph-id' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no connection graph-id in this org that is not removed',
    });
  });
});

describe('the words of the tools of a connection', () => {
  it('count the tools of the page, and say where more remain', async () => {
    const { registration } = await listingOver(fakeConnections());
    const words = registration.plainLanguage;
    const page = { connection: 'graph-id', server: 'graph', next_cursor: null };
    const asked = { id: 'graph-id' };
    const echo = { name: 'echo', description: '' };

    expect([
      words?.outcome({ ...page, tools: [echo], has_more: false }, asked),
      words?.outcome({ ...page, tools: [echo, echo], has_more: true }, asked),
      words?.attempt(asked),
    ]).toEqual([
      'The connection “graph” offers 1 tool on this page.',
      'The connection “graph” offers 2 tools on this page, and more remain.',
      'list the tools of the connection',
    ]);
  });
});
