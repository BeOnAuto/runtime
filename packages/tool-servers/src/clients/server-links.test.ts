import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { secretsOf } from '../bounds/secrets.ts';
import type { AuthSettings, McpServerSettings } from '../settings/server-settings.ts';
import {
  fetchWithDeletion,
  recordingTimer,
  serveFakeMcp,
  testClientInfo,
  type FakeMcpOptions,
  type FakeMcpServer,
} from '../testing/index.ts';
import { errorsNoLongerReported } from './mcp-client.ts';
import type { CallSettled, ServerClient } from './server-client.ts';
import { failureOf } from './server-failures.ts';
import { serverLink } from './server-links.ts';

const timing = { callMs: 5000, openMs: 5000, longestRetryWaitMs: 1000 };

const clientSecret = 'graph-client-secret-81c2';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(options?: FakeMcpOptions): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp(options);
  closing.push(fake.close);
  return fake;
}

function httpSettings(url: string, changes: Partial<McpServerSettings> = {}): McpServerSettings {
  return {
    type: 'mcp',
    name: 'graph',
    url,
    headers: new Map(),
    auth: null,
    orgs: ['acme'],
    playbooks: null,
    allowed: null,
    record_content: false,
    request_id: null,
    secrets: [],
    connection: null,
    provider: null,
    ...changes,
  };
}

function authOf(fake: FakeMcpServer): AuthSettings {
  return {
    issuer: fake.origin,
    client_id: 'playbook',
    scope: null,
    credential: { kind: 'client_secret', client_secret: Redacted.make(clientSecret) },
  };
}

function linked(settings: McpServerSettings, options: Partial<Parameters<typeof serverLink>[1]> = {}) {
  const secrets = secretsOf([]);
  const reported: string[] = [];
  const link = serverLink(settings, {
    clientInfo: testClientInfo,
    fetch: globalThis.fetch,
    secrets,
    now: Date.now,
    timing,
    reportOutput: (_server, line) => {
      reported.push(line);
    },
    ...options,
  });
  closing.push(link.stop);
  return { link, secrets, reported };
}

const searched = (client: ServerClient) =>
  client.call({
    tool: 'search',
    input: { query: 'acme' },
    meta: {},
    signal: new AbortController().signal,
    timeoutMs: timing.callMs,
  });

function failureOfCall(settled: CallSettled) {
  return 'error' in settled ? failureOf(settled.error) : undefined;
}

async function failureOfTaking(link: ReturnType<typeof linked>['link']) {
  const failure: unknown = await link.take().then(
    () => null,
    (error: unknown) => error,
  );
  return failureOf(failure);
}

describe('a link to an mcp server', () => {
  it('shares one session between its holders and ends it when the last lets go', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    const first = await link.take();
    const second = await link.take();
    await link.release();
    const openWhileHeld = fake.openSessions();
    await link.release();

    expect(second).toBe(first);
    expect(openWhileHeld).toBe(1);
    expect(fake.openSessions()).toBe(0);
    expect(fake.endedSessions()).toBe(1);
    expect(fake.seen().map(({ method }) => method)).toContain('DELETE');
  });

  it('opens a new session in place of a failed one, once for everyone who saw it fail', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    const failed = await link.take();
    const renewed = await link.renew(failed);
    const renewedAgain = await link.renew(failed);

    expect(renewedAgain).toBe(renewed);
    expect(renewed).not.toBe(failed);
    expect(fake.endedSessions()).toBe(1);
    expect(await searched(renewed)).toMatchObject({ result: { content: [{ text: 'Found 2 rows for acme.' }] } });
  });
});

describe('opening a session', () => {
  it('forgets a session it could not open, and opens one on the next take', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    fake.answerNextWith(503);

    expect(await failureOfTaking(link)).toEqual({ kind: 'failing', message: 'The tool server answered HTTP 503' });
    expect(await link.take()).toBeDefined();
  });

  it('cannot reach a server that is not listening', async () => {
    const fake = await serveFakeMcp();
    await fake.close();
    const { link } = linked(httpSettings(fake.url));

    expect(await failureOfTaking(link)).toEqual({
      kind: 'unreachable',
      message: 'The tool server could not be reached',
    });
  });

  it('waits out a 429 that asks for no longer than the longest wait, once', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    fake.answerNextWith(429, 1, { 'retry-after': '0' });

    expect(await searched(await link.take())).toMatchObject({
      result: { content: [{ text: 'Found 2 rows for acme.' }] },
    });
    expect(fake.seen().filter(({ rpc }) => rpc === 'initialize')).toHaveLength(2);
  });

  it('fails on a 429 that asks for a longer wait, for none, or comes again', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));
    const rateLimited = { kind: 'rate_limited', message: 'The tool server answered HTTP 429' };

    fake.answerNextWith(429, 1, { 'retry-after': '5' });
    expect(await failureOfTaking(link)).toEqual(rateLimited);
    fake.answerNextWith(429);
    expect(await failureOfTaking(link)).toEqual(rateLimited);
    fake.answerNextWith(429, 2, { 'retry-after': '0' });
    expect(await failureOfTaking(link)).toEqual(rateLimited);
  });
});

describe('the headers and the end of a session', () => {
  it('sends the headers of its entry', async () => {
    const fake = await fakeServer({ bearer: 'graph-api-key-4f1d9a7c2b' });
    const { link } = linked(
      httpSettings(fake.url, {
        headers: new Map([['Authorization', Redacted.make('Bearer graph-api-key-4f1d9a7c2b')]]),
      }),
    );
    const { link: unauthorized } = linked(httpSettings(fake.url));

    expect(await searched(await link.take())).toMatchObject({ result: { content: [{ type: 'text' }] } });
    expect(await failureOfTaking(unauthorized)).toMatchObject({ kind: 'key_refused' });
  });

  it('stops the session it holds, and stops nothing when it holds none', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url));

    await link.stop();
    await link.take();
    await link.stop();

    expect(fake.endedSessions()).toBe(1);
  });
});

const endings: readonly ('release' | 'stop')[] = ['release', 'stop'];

describe('an http server that does not end its session', () => {
  it.each(endings)('bounds %s and aborts a session deletion that never answers', async (ending) => {
    const fake = await fakeServer();
    const deleting = Promise.withResolvers<unknown>();
    const unanswered = Promise.withResolvers<Response>();
    const { link } = linked(httpSettings(fake.url), {
      timing: { ...timing, openMs: 1000 },
      fetch: fetchWithDeletion(fetch, (request) => {
        deleting.resolve(request);
        return unanswered.promise;
      }),
    });
    const client = await link.take();
    const finished = link[ending]().then(() => true);
    const request = await deleting.promise;

    expect(await finished).toBe(true);
    expect(request).toHaveProperty('signal.aborted', true);
    await client.closed;
    unanswered.resolve(new Response(null, { status: 204 }));
  });

  it('closes the client even when the server refuses deletion', async () => {
    const fake = await fakeServer();
    const { link } = linked(httpSettings(fake.url), {
      fetch: fetchWithDeletion(fetch, () => Promise.resolve(new Response(null, { status: 500 }))),
    });
    const client = await link.take();

    await expect(link.release().then(() => client.closed)).resolves.toBeUndefined();
  });
});

describe('an http session that ends before the deadline', () => {
  it('stops waiting for the deadline when the server answers', async () => {
    const fake = await fakeServer();
    const { timer, waits } = recordingTimer();
    const { link } = linked(httpSettings(fake.url), { timer });
    const client = await link.take();

    await link.release();

    await expect(client.closed).resolves.toBeUndefined();
    expect(waits()).toEqual([{ ms: timing.openMs, stopped: true }]);
  });
});

describe('a link to an http server with an auth block', () => {
  it('sends a token minted from the client credentials, scrubbed from what the server says', async () => {
    const fake = await fakeServer({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
    const { link, secrets } = linked(httpSettings(fake.url, { auth: authOf(fake) }));

    await link.take();
    const [, token] = String(fake.seen().at(-1)?.authorization).split(' ');

    expect(fake.tokenRequests()).toBe(1);
    expect(secrets.scrub(`Rejected ${String(token)}`)).toBe('Rejected [redacted]');
  });

  it('authenticates again once on a 401, and fails on a second as a refused key', async () => {
    const fake = await fakeServer({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
    const { link } = linked(httpSettings(fake.url, { auth: authOf(fake) }));
    const client = await link.take();

    fake.revokeTokens();
    const reauthenticated = await searched(client);
    fake.answerNextWith(401, 2);
    const refused = await searched(client);

    expect(reauthenticated).toMatchObject({ result: { content: [{ text: 'Found 2 rows for acme.' }] } });
    expect(failureOfCall(refused)).toEqual({ kind: 'key_refused', message: 'The tool server answered HTTP 401' });
    expect(fake.tokenRequests()).toBe(3);
  });
});

describe('an http server that sends what is not JSON-RPC', () => {
  it('has the first 100 of the errors it causes reported, and then a line saying the rest is not shown', async () => {
    const fake = await fakeServer();
    const { link, reported } = linked(httpSettings(fake.url));
    fake.answerNextCallAfterNoise(150);

    expect(await searched(await link.take())).toHaveProperty('result.content.0.text', 'Found 2 rows for acme.');
    expect([reported.length, reported.indexOf(errorsNoLongerReported)]).toEqual([101, 100]);
  });
});
