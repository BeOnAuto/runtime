import type { FetchOfACall } from '@on.auto/operations';
import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeApiAnswers } from '../api-testing/fake-api-answers.ts';
import { fakeConnections, type FakeConnection, type FakeConnections } from '../testing/fake-connections.ts';
import { closedAfter } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { answeredEmpty, answeredJson, answeringService, type AnsweringService } from '../testing/sent-requests.ts';
import type { ConnectionRequest, RequestedOnce } from './declared-requests.ts';

const origin = 'https://api.tracker.example.com';

const pastedKey = 'tracker-key-7f3c1a9e5b';

const subscribing: ConnectionRequest = {
  org: 'acme',
  playbook: 'alpha',
  server: 'tracker',
  method: 'POST',
  url: `${origin}/projects/acme-web/hooks`,
  body: { url: 'https://runtime.example.com/events', secret: 'subscription-secret-41d8c2' },
};

const tracker: FakeConnection = {
  id: 'tracker-id',
  name: 'tracker',
  entry: {
    url: 'https://acme.tracker.example.com/mcp',
    headers: { Authorization: 'Bearer ${TRACKER_KEY}', 'X-Tenant': 'acme-eu' },
  },
  environment: { TRACKER_KEY: pastedKey },
  requestOrigins: [origin],
};

type Access = ReturnType<typeof reportingAccess>['access'];

function accessOver(connections: FakeConnections, fetch: FetchOfACall, file: Readonly<Record<string, unknown>> = {}) {
  const { access } = reportingAccess(file, { fetch, connections });
  closedAfter(access.close);
  return access;
}

function connectedAs(...connections: readonly FakeConnection[]): FakeConnections {
  const connected = fakeConnections();
  for (const connection of connections) {
    connected.connect('acme', connection);
  }
  return connected;
}

function requested(access: Access, changes: Partial<ConnectionRequest> = {}): Promise<RequestedOnce> {
  return Effect.runPromise(access.requestOnce({ ...subscribing, ...changes }));
}

function sentThrough(service: AnsweringService, connections = connectedAs(tracker)): Access {
  return accessOver(connections, service.fetch);
}

describe('a request through a connection', () => {
  it('is sent where its entry declares, carrying the key the connection places and no other header of it', async () => {
    const service = answeringService(answeredJson(201, { id: 'hook-1' }));

    expect(await requested(sentThrough(service))).toEqual({
      kind: 'answered',
      outcome: 'result',
      answer: { id: 'hook-1' },
    });
    expect(service.sent().map(({ url, headers }) => [url, headers])).toEqual([
      [
        subscribing.url,
        { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${pastedKey}` },
      ],
    ]);
  });

  it('is sent through no connection whose entry declares no request, as one an agent adds, even to its own server', async () => {
    const service = answeringService(answeredJson(201, { id: 'hook-1' }));
    const { requestOrigins: _declared, ...added } = tracker;
    const access = sentThrough(service, connectedAs(added));

    expect([
      await requested(access),
      await requested(access, { url: 'https://acme.tracker.example.com/mcp/hooks' }),
    ]).toEqual([
      { kind: 'unopened', because: 'connection_not_allowed' },
      { kind: 'unopened', because: 'connection_not_allowed' },
    ]);
    expect(service.sent()).toEqual([]);
  });
});

describe('a request refused before it is sent', () => {
  it('is refused as a call is, by the same words, where the connection is not there, not ready or serves another playbook', async () => {
    const service = answeringService(answeredJson(201, { id: 'hook-1' }));
    const connections = connectedAs({
      ...tracker,
      id: 'beta-id',
      name: 'beta',
      entry: { ...tracker.entry, playbooks: ['beta'] },
    });
    connections.pend('acme', { ...tracker, id: 'pending-id', name: 'pending' });
    connections.connect('acme', { ...tracker, id: 'broken-id', name: 'broken' });
    connections.breakOff('broken-id', 'The key of the connection broken was refused');
    const access = accessOver(connections, service.fetch, { files: { url: `${origin}/mcp`, org: 'acme' } });

    expect(
      await Promise.all(
        ['unknown', 'beta', 'pending', 'broken', 'files'].map((server) => requested(access, { server })),
      ),
    ).toEqual([
      { kind: 'unopened', because: 'tool_server_not_configured' },
      { kind: 'unopened', because: 'tool_server_not_configured' },
      { kind: 'unopened', because: 'connection_pending' },
      { kind: 'unopened', because: 'connection_broken' },
      { kind: 'unopened', because: 'connection_not_allowed' },
    ]);
    expect(service.sent()).toEqual([]);
  });
});

describe('the credential of a request through a connection', () => {
  it('marks the connection broken once its key is refused, as a call does, and is sent no more', async () => {
    const service = answeringService(answeredEmpty(401));
    const connections = connectedAs(tracker);
    const access = sentThrough(service, connections);

    expect([await requested(access), await requested(access)]).toEqual([
      { kind: 'answered', outcome: 'server_failure', because: 'connection_broken' },
      { kind: 'unopened', because: 'connection_broken' },
    ]);
    expect([service.sent().length, connections.refusalsTold()]).toEqual([1, ['tracker-id']]);
  });

  it('carries the token of a sign-in nowhere while its sign-in records no resource, and asks for no token', async () => {
    const service = answeringService(answeredJson(201, { id: 'hook-1' }));
    const auth = { issuer: 'https://auth.tracker.example.com', client_id: 'playbook', client_secret: '${SECRET}' };
    const signedIn = {
      ...tracker,
      entry: { url: tracker.entry['url'], auth },
      environment: { SECRET: 'client-secret-0a1b' },
    };

    expect(await requested(sentThrough(service, connectedAs(signedIn)))).toEqual({
      kind: 'unopened',
      because: 'scope_lacking',
    });
    expect(service.sent()).toEqual([]);
  });
});

type Handler = (request: Readonly<Request>) => Promise<Response>;

function servedAt(issuerOrigin: string, issuer: Handler, api: Handler): FetchOfACall {
  return (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    return new URL(request.url).origin === issuerOrigin ? issuer(request) : api(request);
  };
}

describe('a request through a connection to an HTTP API', () => {
  it("carries the token its link mints for the API's calls, under the API's base URL alone", async () => {
    const api = 'https://api.ledgers.example.com';
    const auth = 'https://auth.ledgers.example.com';
    const client = { clientId: 'playbook', clientSecret: 'ledgers-secret-4c', expiresInSeconds: 3600 };
    const answers = fakeApiAnswers({ client });
    const issuing = Option.getOrThrow(Option.fromNullishOr(answers.issuing));
    const fetch = servedAt(auth, issuing.handlerAt(auth), answers.handler);
    const ledgers: FakeConnection = {
      id: 'ledgers-id',
      name: 'ledgers',
      entry: {
        document: `${api}/openapi.json`,
        auth: { issuer: auth, client_id: 'playbook', client_secret: '${SECRET}' },
      },
      environment: { SECRET: client.clientSecret },
      requestOrigins: [api],
    };
    const access = accessOver(connectedAs(ledgers), fetch);
    const read = (url: string) =>
      Effect.runPromise(access.requestOnce({ org: 'acme', playbook: 'alpha', server: 'ledgers', method: 'GET', url }));

    expect([
      await read(`${api}/v1/search?query=acme`),
      await read(`${api}/v1/search?query=acme`),
      await read(`${api}/openapi.json`),
    ]).toMatchObject([
      { kind: 'answered', outcome: 'result' },
      { kind: 'answered', outcome: 'result' },
      { kind: 'unopened', because: 'scope_lacking' },
    ]);
    expect(answers.seen().filter(({ path }) => path === '/v1/search')).toHaveLength(2);
    expect([issuing.tokenRequests(), answers.documentReads()]).toEqual([1, 1]);
  });
});

function spanEnding(ending: Readonly<Record<string, string | number>>) {
  const declared = { 'url.scheme': 'https', 'server.address': 'api.tracker.example.com' };
  return { name: 'POST', kind: 'client', attributes: { 'http.request.method': 'POST', ...declared, ...ending } };
}

const leftOut = [
  pastedKey,
  'subscription-secret-41d8c2',
  'acme-web',
  '/hooks',
  'hook-answered-5e2a',
  'runtime.example.com',
];

describe('what a request through a connection leaves behind', () => {
  it('holds no body, header, path or answer in a log, a span or a failure; the answer goes to its caller alone', async () => {
    const service = answeringService(answeredJson(201, { id: 'hook-answered-5e2a' }), answeredEmpty(401));
    const access = sentThrough(service);
    const recording = recordingTracer();
    const logs = capturedLogs();
    const traced = (request: Partial<ConnectionRequest> = {}) =>
      Effect.runPromise(
        access
          .requestOnce({ ...subscribing, ...request })
          .pipe(Effect.withTracer(recording.tracer), Effect.provide(logs.layer)),
      );

    const [result, ...failed] = [
      await traced(),
      await traced(),
      await traced({ url: 'https://api.tracker.example.com:8443/hooks' }),
    ];
    const left = JSON.stringify([failed, recording.spans(), logs.logged()]);

    expect(recording.spans().map(({ name, kind, attributes }) => ({ name, kind, attributes }))).toEqual([
      spanEnding({}),
      spanEnding({ 'error.type': 'server_failure' }),
      spanEnding({ 'server.port': 8443, 'error.type': 'connection_broken' }),
    ]);
    expect(logs.logged()).toEqual([]);
    expect(result).toEqual({ kind: 'answered', outcome: 'result', answer: { id: 'hook-answered-5e2a' } });
    expect(leftOut.filter((value) => left.includes(value))).toEqual([]);
  });
});
