import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallFetch } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  controlledSignals,
  fakeStdioServerPath,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  serveFakeMcp,
  toolRun,
  type ReportingAccess,
} from '../testing/index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const clientSecret = 'graph-client-secret-81c2';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface RecordingFetch {
  readonly fetch: typeof globalThis.fetch;
  readonly asked: () => number;
}

function recordingFetch(): RecordingFetch {
  const asked = { times: 0 };
  return {
    fetch: (...[address, init]: readonly [unknown, unknown?]) => {
      asked.times += 1;
      return globalThis.fetch(String(address), Object.assign({}, init));
    },
    asked: () => asked.times,
  };
}

function accessTo(servers: Readonly<Record<string, unknown>>, own: RecordingFetch): ReportingAccess['access'] {
  const { access } = reportingAccess(servers, {
    environment: {
      GRAPH_API_KEY: apiKey,
      GRAPH_CLIENT_SECRET: clientSecret,
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
    },
    timing: patientTiming,
    fetch: own.fetch,
  });
  closing.push(access.close);
  return access;
}

async function calledOn(access: ReportingAccess['access'], server: string, ofTheCall?: RecordingFetch) {
  const opening = access.open(toolRun(recordingCallJournal()), [{ server, tool: 'search' }]);
  const lent = ofTheCall === undefined ? opening : opening.pipe(Effect.provideService(CallFetch, ofTheCall.fetch));
  const tools = Result.getOrThrow(await Effect.runPromise(Effect.result(lent)));
  const reply = await tools.offered[0]?.call({ callId: 'call-1', input: { query: 'acme' } }, controlledSignals());
  await tools.close();
  return reply?.isError;
}

async function graphServer() {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
}

async function serverOfClientCredentials() {
  const fake = await serveFakeMcp({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  const auth = { issuer: fake.origin, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };
  return { fake, entry: { url: fake.url, auth, org: 'acme' } };
}

describe('the access over a lent fetch', () => {
  it('is made once for the fetch and taken again by every call the fetch is lent to, with the token it minted, and holds no session once a call is done', async () => {
    const { fake, entry } = await serverOfClientCredentials();
    const [own, lent, another] = [recordingFetch(), recordingFetch(), recordingFetch()];
    const access = accessTo({ graph: entry }, own);

    const replies = [await calledOn(access, 'graph', lent), await calledOn(access, 'graph', lent)];
    const sessions = [fake.openSessions(), fake.endedSessions(), fake.tokenRequests()];
    await calledOn(access, 'graph', another);

    expect(replies).toEqual([false, false]);
    expect(sessions).toEqual([0, 2, 1]);
    expect([fake.openSessions(), fake.endedSessions(), fake.tokenRequests(), own.asked()]).toEqual([0, 3, 2, 0]);
  });
});

describe('the fetch the tools of a run reach their servers with', () => {
  it('is the fetch the context of the operation gives, not the access its own, so each call of a shell has its own', async () => {
    const [own, ofTheCall] = [recordingFetch(), recordingFetch()];
    const access = accessTo({ graph: await graphServer() }, own);

    expect(await calledOn(access, 'graph', ofTheCall)).toBe(false);
    expect([own.asked(), ofTheCall.asked() > 0]).toEqual([0, true]);
  });

  it('is the access its own when the context of the operation gives none, as on the server', async () => {
    const own = recordingFetch();
    const access = accessTo({ graph: await graphServer() }, own);

    expect(await calledOn(access, 'graph')).toBe(false);
    expect(own.asked()).toBeGreaterThan(0);
  });

  it('is none for a server on stdio, whose one process serves the calls of every fetch', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'fake-mcp-'));
    closing.push(() => rm(folder, { recursive: true }));
    const local = {
      command: process.execPath,
      args: [fakeStdioServerPath(), '--start-once', join(folder, 'started')],
      env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
      org: 'acme',
    };
    const own = recordingFetch();
    const access = accessTo({ graph: await graphServer(), local }, own);

    expect(await calledOn(access, 'local')).toBe(false);
    expect(await calledOn(access, 'local', recordingFetch())).toBe(false);
    expect(await calledOn(access, 'graph', recordingFetch())).toBe(false);
  });
});
