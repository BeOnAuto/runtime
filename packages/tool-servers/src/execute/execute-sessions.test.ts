import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fetchWithDeletion,
  patientTiming,
  playbookToolCalls,
  reportingAccess,
  type AccessOptions,
  type WritesOptions,
} from '../testing/index.ts';
import {
  fakeApiKey,
  fakeStdioServerPath,
  serveFakeMcp,
  type FakeMcpOptions,
  type FakeMcpServer,
} from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, ...options });
  closing.push(fake.close);
  return fake;
}

function accessTo(servers: Readonly<Record<string, unknown>>, fetching: AccessOptions = {}) {
  const { access } = reportingAccess(servers, {
    ...fetching,
    timing: patientTiming,
    environment: { GRAPH_API_KEY: fakeApiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
  });
  closing.push(access.close);
  return access;
}

function callsByHand(access: ReturnType<typeof accessTo>, writes: WritesOptions = {}) {
  const calls = playbookToolCalls(access, writes);
  return {
    ...calls,
    execute: (input: unknown, signal?: AbortSignal) =>
      calls.call('execute', input, signal === undefined ? {} : { signal }),
  };
}

function graphOn(fake: FakeMcpServer) {
  return { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } };
}

function requestsOf(fake: FakeMcpServer): readonly string[] {
  return fake.seen().map(({ method, rpc = '' }) => `${method} ${rpc}`.trim());
}

const callAndEnd: ReadonlySet<string> = new Set(['POST tools/call', 'DELETE']);

const searching = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

const sleeping = { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } };

describe('the session a call made by hand opens', () => {
  it('is ended once the call has answered, six requests in all, and five where the server issues no session id', async () => {
    const fake = await fakeServer();
    const sessionless = await fakeServer({ issuesSessionIds: false });

    await callsByHand(accessTo(graphOn(fake))).execute(searching);
    await callsByHand(accessTo(graphOn(sessionless))).execute(searching);

    expect(requestsOf(fake)).toEqual(
      expect.arrayContaining(['POST initialize', 'POST notifications/initialized', 'GET', 'POST tools/list']),
    );
    expect(requestsOf(fake).filter((request) => callAndEnd.has(request))).toEqual(['POST tools/call', 'DELETE']);
    expect(requestsOf(fake)).toHaveLength(6);
    expect(requestsOf(sessionless)).toHaveLength(5);
    expect(requestsOf(sessionless)).not.toContain('DELETE');
    expect([fake.openSessions(), fake.endedSessions()]).toEqual([0, 1]);
  });

  it('is one for a call and a search made at once', async () => {
    const fake = await fakeServer();
    const access = accessTo(graphOn(fake));
    const { execute, call } = callsByHand(access);

    await Promise.all([
      execute(searching),
      call('search', {}),
      Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' })),
    ]);

    expect(requestsOf(fake).filter((request) => request === 'POST initialize')).toHaveLength(1);
    expect(fake.endedSessions()).toBe(1);
  });
});

describe('a call whose caller goes away while the tool is called', () => {
  it('records a start and no answer, answers nothing, sends no second call and still lets the session go', async () => {
    const fake = await fakeServer();
    const access = accessTo(graphOn(fake));
    const { execute, recorded } = callsByHand(access);
    const leaving = new AbortController();

    const settling = execute(sleeping, leaving.signal);
    await until(() => fake.received().length === 1);
    leaving.abort();
    const settled = await settling;

    expect(settled).toEqual({ status: 'cancelled' });
    await until(() => fake.endedSessions() === 1);
    expect((await recorded()).map(({ type }) => type)).toEqual(['tool_call_started']);
    expect(fake.received()).toHaveLength(1);
    await callsByHand(access).execute(searching);
    expect([fake.endedSessions(), fake.openSessions()]).toEqual([2, 0]);
  });
});

describe('a call whose caller goes away while its server is slow to end the session', () => {
  it('answers cancelled without waiting for the session to end, and the session still ends', async () => {
    const fake = await fakeServer();
    const deleting = Promise.withResolvers<void>();
    const letGo = Promise.withResolvers<void>();
    const slowToEnd = fetchWithDeletion(fetch, async (_request, sent) => {
      deleting.resolve();
      await letGo.promise;
      return sent();
    });
    const { execute } = callsByHand(accessTo(graphOn(fake), { fetch: slowToEnd }));
    const leaving = new AbortController();

    const settling = execute(sleeping, leaving.signal);
    await until(() => fake.received().length === 1);
    leaving.abort();
    const settled = await settling;
    await deleting.promise;
    letGo.resolve();

    expect(settled).toEqual({ status: 'cancelled' });
    await until(() => fake.endedSessions() === 1);
  });
});

describe('a call the ledger cannot record', () => {
  it('fails with an incident and sends nothing, since the start is recorded first', async () => {
    const fake = await fakeServer();
    const { execute, incidents } = callsByHand(accessTo(graphOn(fake)), { writesRefused: true });

    expect(await execute(searching)).toEqual({ status: 'failed', incident: incidents()[0]?.id });
    expect(incidents()).toHaveLength(1);
    expect(fake.received()).toEqual([]);
    await until(() => fake.endedSessions() === 1);
  });

  it('is reported as an incident naming the call once its caller has gone, and sends nothing', async () => {
    const fake = await fakeServer();
    const leaving = new AbortController();
    const recording = Promise.withResolvers<void>();
    const { execute, incidents, writesAttempted } = callsByHand(accessTo(graphOn(fake)), {
      writesRefused: true,
      writesHeldUntil: recording.promise,
    });

    const settling = execute(searching, leaving.signal);
    await until(() => writesAttempted() === 1);
    leaving.abort();
    recording.resolve();
    const settled = await settling;

    expect(settled).toEqual({ status: 'cancelled' });
    expect(incidents()).toHaveLength(1);
    expect(incidents()[0]).toMatchObject({
      original: { message: 'The ledger refused the write' },
      call: { operation: 'execute', org: 'acme', playbook: 'alpha', caller: 'acme-builder' },
    });
    expect(fake.received()).toEqual([]);
    await until(() => fake.endedSessions() === 1);
  });
});

describe('a call of a stdio server', () => {
  it('starts its process once, and keeps it for the next call', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'hand-calls-'));
    closing.push(() => {
      rmSync(folder, { recursive: true });
      return Promise.resolve();
    });
    const limitless = {
      command: process.execPath,
      args: [fakeStdioServerPath(), '--start-once', join(folder, 'started')],
      env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
      org: 'acme',
    };
    const { execute } = callsByHand(accessTo({ limitless }));

    const first = await execute({ server: 'limitless', tool: 'search', arguments: { query: 'acme' } });
    const second = await execute({ server: 'limitless', tool: 'search', arguments: { query: 'again' } });

    expect([first, second]).toMatchObject([
      { status: 'succeeded', output: { outcome: 'result', text: 'Found 2 rows for acme.' } },
      { status: 'succeeded', output: { outcome: 'result', text: 'Found 2 rows for again.' } },
    ]);
  });
});
