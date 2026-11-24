import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallFetch, CallSubjectTokens, type SubjectTokensOfACall } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { jwtTokenType } from '../exchange/token-exchanges.ts';
import { fakeConnections } from '../testing/fake-connections.ts';
import {
  controlledSignals,
  fakeMcpInProcess,
  inProcessFetch,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  toolRun,
  type ReportingAccess,
} from '../testing/index.ts';
import { fakeStdioServerPath } from '../testing/served-fakes.ts';

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
      return inProcessFetch(String(address), Object.assign({}, init));
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

function graphServer() {
  const fake = fakeMcpInProcess({ bearer: apiKey });
  closing.push(fake.close);
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
}

function serverOfClientCredentials() {
  const fake = fakeMcpInProcess({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  const auth = { issuer: fake.origin, client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };
  return { fake, entry: { url: fake.url, auth, org: 'acme' } };
}

describe('the access over a lent fetch', () => {
  it('is made once for the fetch and taken again by every call the fetch is lent to, with the token it minted, and holds no session once a call is done', async () => {
    const { fake, entry } = serverOfClientCredentials();
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
    const access = accessTo({ graph: graphServer() }, own);

    expect(await calledOn(access, 'graph', ofTheCall)).toBe(false);
    expect([own.asked(), ofTheCall.asked() > 0]).toEqual([0, true]);
  });

  it('is the access its own when the context of the operation gives none, as on the server', async () => {
    const own = recordingFetch();
    const access = accessTo({ graph: graphServer() }, own);

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
    const access = accessTo({ graph: graphServer(), local }, own);

    expect(await calledOn(access, 'local')).toBe(false);
    expect(await calledOn(access, 'local', recordingFetch())).toBe(false);
    expect(await calledOn(access, 'graph', recordingFetch())).toBe(false);
  });
});

interface CountingSigner {
  readonly tokens: SubjectTokensOfACall;
  readonly askedFor: () => readonly string[];
}

function countingSigner(): CountingSigner {
  const asked: string[] = [];
  return {
    tokens: {
      signedFor: ({ org }) => {
        asked.push(org);
        return Promise.resolve(`signed-for-${org}`);
      },
    },
    askedFor: () => [...asked],
  };
}

const exchangedBearer = 'graph-exchanged-token-7e21';

function exchangingFetch(): typeof globalThis.fetch {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    new URL(String(address)).hostname === 'sts.graph.example.com'
      ? Promise.resolve(Response.json({ access_token: exchangedBearer, token_type: 'Bearer', expires_in: 3600 }))
      : inProcessFetch(String(address), Object.assign({}, init));
}

function exchangingAccess(composed: CountingSigner): ReportingAccess['access'] {
  const fake = fakeMcpInProcess({ bearer: exchangedBearer });
  closing.push(fake.close);
  const connections = fakeConnections();
  connections.connect('acme', {
    id: 'graph-id',
    name: 'graph',
    entry: { url: fake.url },
    auth: {
      grant: 'token_exchange',
      scope: 'graph.read',
      token_endpoint: 'https://sts.graph.example.com/v1/token',
      audience: '//identity.graph.example.com/pools/auto',
      subject_token: { type: jwtTokenType, audience: 'https://identity.graph.example.com/pools/auto' },
      credential: { kind: 'subject_token' },
    },
  });
  const { access } = reportingAccess(
    {},
    { timing: patientTiming, fetch: exchangingFetch(), connections, subjectTokens: composed.tokens },
  );
  closing.push(access.close);
  return access;
}

const searched = {
  org: 'acme',
  playbook: 'alpha',
  reference: { server: 'graph', tool: 'search' },
  input: { query: 'acme' },
  meta: {},
};

describe('the subject token a connection exchanges for its token', () => {
  it('is signed by the signer the call binds, for the organization the connection serves, not by the composed one', async () => {
    const [composed, ofTheCall] = [countingSigner(), countingSigner()];
    const access = exchangingAccess(composed);

    const called = await Effect.runPromise(
      access.callOnce(searched).pipe(Effect.provideService(CallSubjectTokens, ofTheCall.tokens)),
    );

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect([ofTheCall.askedFor(), composed.askedFor()]).toEqual([['acme'], []]);
  });

  it('is signed by the composed signer where the call binds none, as on the server', async () => {
    const composed = countingSigner();
    const access = exchangingAccess(composed);

    expect(await Effect.runPromise(access.callOnce(searched))).toMatchObject({ kind: 'answered', outcome: 'result' });
    expect(composed.askedFor()).toEqual(['acme']);
  });
});
