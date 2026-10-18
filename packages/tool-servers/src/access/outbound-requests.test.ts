import { withUserAgent } from '@on.auto/outbound';
import { Effect, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeConnections, type FakeConnections } from '../testing/fake-connections.ts';
import {
  describedAccess,
  patientTiming,
  serveFakeApi,
  serveFakeMcp,
  type FakeApiServer,
  type FakeMcpServer,
} from '../testing/index.ts';

const runtime = 'auto-runtime/0.0.0-test';

const clientSecret = 'graph-client-secret-81c2';

const client = { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 };

const environment = { GRAPH_CLIENT_SECRET: clientSecret };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function authOf(issuer: string) {
  return { issuer, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };
}

function issuerOf(api: FakeApiServer): string {
  return Option.getOrThrow(Option.fromNullishOr(api.issuing)).issuer;
}

async function fakes(): Promise<{ readonly api: FakeApiServer; readonly mcp: FakeMcpServer }> {
  const api = await serveFakeApi({ client });
  const mcp = await serveFakeMcp({ client });
  closing.push(api.close, mcp.close);
  return { api, mcp };
}

async function accessThrough(entries: Readonly<Record<string, unknown>>, connections = fakeConnections()) {
  const { access } = await describedAccess(entries, {
    environment,
    timing: patientTiming,
    fetch: withUserAgent(globalThis.fetch, runtime),
    connections,
  });
  closing.push(access.close);
  return access;
}

function connectedTo(ledger: FakeApiServer): FakeConnections {
  const connections = fakeConnections();
  connections.connect('acme', {
    id: 'ledger-id',
    name: 'ledger',
    entry: { document: ledger.documentUrl, auth: authOf(issuerOf(ledger)) },
    environment,
  });
  return connections;
}

function searched(access: Awaited<ReturnType<typeof accessThrough>>, server: string) {
  return Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server, tool: 'search' },
      input: { query: 'acme' },
      meta: {},
    }),
  );
}

describe('every request a tool access makes to a tool server', () => {
  it('goes through the fetch it is given: the reads of a document and of metadata, the requests of tokens and the calls', async () => {
    const { api, mcp } = await fakes();
    const ledger = await serveFakeApi({ client });
    closing.push(ledger.close);
    const entries = {
      billing: { org: 'acme', document: api.documentUrl, auth: authOf(issuerOf(api)) },
      graph: { org: 'acme', url: mcp.url, auth: authOf(mcp.origin) },
    };
    const access = await accessThrough(entries, connectedTo(ledger));

    const answered = [
      await searched(access, 'billing'),
      await searched(access, 'graph'),
      await searched(access, 'ledger'),
    ];
    const heard = [...api.heard(), ...mcp.heard(), ...ledger.heard()];

    expect(answered).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }, { outcome: 'result' }]);
    expect(heard.map(({ method, path }) => `${method} ${path}`)).toEqual(
      expect.arrayContaining([
        'GET /openapi.json',
        'GET /.well-known/oauth-protected-resource/v1',
        'GET /.well-known/oauth-authorization-server',
        'POST /token',
        'GET /v1/search?query=acme',
        'GET /.well-known/oauth-protected-resource/mcp',
        'POST /mcp',
      ]),
    );
    expect(ledger.heard().map(({ method, path }) => `${method} ${path}`)).toEqual(
      expect.arrayContaining(['GET /openapi.json', 'POST /token', 'GET /v1/search?query=acme']),
    );
    expect(new Set(heard.map(({ userAgent }) => userAgent))).toEqual(new Set([runtime]));
  });
});

describe('the User-Agent of a request a tool access makes to a tool server', () => {
  it('is the one among the headers of an entry on its calls, and the one of its fetch elsewhere', async () => {
    const { api, mcp } = await fakes();
    const own = { 'User-Agent': 'operator-agent/2.0' };
    const access = await accessThrough({
      billing: { org: 'acme', document: api.documentUrl, auth: authOf(issuerOf(api)), headers: own },
      graph: { org: 'acme', url: mcp.url, auth: authOf(mcp.origin), headers: own },
    });

    await searched(access, 'billing');
    await searched(access, 'graph');
    const agentOf = (path: string) => [...api.heard(), ...mcp.heard()].find((heard) => heard.path === path)?.userAgent;

    expect(['/v1/search?query=acme', '/mcp', '/openapi.json', '/token'].map((path) => agentOf(path))).toEqual([
      'operator-agent/2.0',
      'operator-agent/2.0',
      runtime,
      runtime,
    ]);
  });
});
