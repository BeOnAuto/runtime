import { Effect, Function, Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { answeredEmpty, answeredJson, answeringService } from '../testing/sent-requests.ts';
import type { BearerSending } from './bearer-requests.ts';
import type { DeclaredRequest, RequestedOnce } from './declared-requests.ts';
import { bearerRequestOnce } from './request-ways.ts';

const origin = 'https://api.tracker.example.com';

const renewing: DeclaredRequest = { method: 'PATCH', url: `${origin}/hooks/hook-1`, body: { active: true } };

type Answered = Parameters<typeof answeringService>[0];

function sendingOver(fetch: BearerSending['fetch'], callMs = 5000): BearerSending {
  return {
    origins: [origin],
    bearer: { kind: 'key', token: Redacted.make('tracker-key-7f3c1a9e5b') },
    fetch,
    reaches: Function.constUndefined,
    callMs,
    mostRequestBytes: 1_048_576,
  };
}

function answeredWith(answer: Answered, beside: Partial<BearerSending> = {}): Promise<RequestedOnce> {
  const sending = { ...sendingOver(answeringService(answer).fetch), ...beside };
  return Effect.runPromise(bearerRequestOnce(renewing, sending));
}

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'], rate_limited: ['ratelimited'] };

function streamedUntil(signal: Readonly<AbortSignal>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode('{"id":'));
      signal.addEventListener('abort', () => {
        controller.error(signal.reason);
      });
    },
  });
}

function signalOf(init: unknown): AbortSignal {
  const given: RequestInit = Object.assign({}, init);
  return Option.getOrThrow(Option.fromNullishOr(given.signal));
}

describe('what a request answered', () => {
  it('is read as a JSON document, or as its text, or as nothing where it says nothing', async () => {
    expect([
      await answeredWith(answeredJson(200, { id: 'hook-1', expires_at: '2026-11-21T00:00:00Z' })),
      await answeredWith(() => new Response('accepted', { status: 202 })),
      await answeredWith(answeredEmpty(204)),
    ]).toEqual([
      { kind: 'answered', outcome: 'result', answer: { id: 'hook-1', expires_at: '2026-11-21T00:00:00Z' } },
      { kind: 'answered', outcome: 'result', answer: 'accepted' },
      { kind: 'answered', outcome: 'result' },
    ]);
  });

  it('is classed by its status as the HTTP API client classes it, reading nothing the service wrote but a scope it lacks', async () => {
    const lacking = { 'www-authenticate': 'Bearer error="insufficient_scope", scope="hooks.write"' };

    expect([
      await answeredWith(answeredEmpty(403, lacking)),
      await answeredWith(answeredJson(403, { message: 'forbidden' })),
      await answeredWith(answeredJson(422, { message: 'invalid' })),
      await answeredWith(answeredEmpty(429, { 'retry-after': '30' })),
      await answeredWith(answeredJson(503, { message: 'down' })),
    ]).toEqual([
      { kind: 'answered', outcome: 'server_failure', because: 'scope_lacking' },
      { kind: 'answered', outcome: 'tool_error' },
      { kind: 'answered', outcome: 'tool_error' },
      { kind: 'answered', outcome: 'server_failure', because: 'rate_limited' },
      { kind: 'answered', outcome: 'server_failure', because: 'failing' },
    ]);
  });

  it('is too large past the bytes an answer read by its pointers may take, and is not kept', async () => {
    const larger = JSON.stringify({ id: 'x'.repeat(65_536) });

    expect(await answeredWith(() => new Response(larger, { status: 200 }))).toEqual({
      kind: 'answered',
      outcome: 'too_large',
    });
  });

  it('is a failure of the server where the connection fails once the request is sent', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    expect(await answeredWith(() => Promise.reject(refused))).toEqual({
      kind: 'answered',
      outcome: 'server_failure',
      because: 'unreachable',
    });
  });
});

describe('a request answered that what it names is not there', () => {
  it('is not found, by HTTP’s own 404 Not Found and 410 Gone, whatever the service wrote', async () => {
    expect([
      await answeredWith(answeredJson(404, { message: 'no such hook' })),
      await answeredWith(answeredEmpty(410)),
    ]).toEqual([
      { kind: 'answered', outcome: 'not_found' },
      { kind: 'answered', outcome: 'not_found' },
    ]);
  });
});

function unanswered(...[, init]: readonly [unknown, unknown?]): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = signalOf(init);
    signal.addEventListener('abort', () => {
      reject(new Error('The request was let go', { cause: signal.reason }));
    });
  });
}

function unfinished(...[, init]: readonly [unknown, unknown?]): Promise<Response> {
  return Promise.resolve(new Response(streamedUntil(signalOf(init)), { status: 200 }));
}

describe('a request that takes longer than a call may', () => {
  it('ends timed out, whether the service never answers or never finishes its answer', async () => {
    expect([
      await Effect.runPromise(bearerRequestOnce(renewing, sendingOver(unanswered, 20))),
      await Effect.runPromise(bearerRequestOnce(renewing, sendingOver(unfinished, 20))),
    ]).toEqual([
      { kind: 'answered', outcome: 'timed_out' },
      { kind: 'answered', outcome: 'timed_out' },
    ]);
  });
});

describe('a request whose service names its failures in a successful answer', () => {
  it("is read by the codes it is given: a refused key's code a refusal of the key, another listed code its failure", async () => {
    expect([
      await answeredWith(answeredJson(200, { ok: false, error: 'invalid_auth' }), { failureCodes }),
      await answeredWith(answeredJson(200, { ok: false, error: 'ratelimited' }), { failureCodes }),
    ]).toEqual([
      { kind: 'answered', outcome: 'server_failure', because: 'key_refused' },
      { kind: 'answered', outcome: 'server_failure', because: 'rate_limited' },
    ]);
  });

  it('is an error, never a refusal, where the code is not listed, and a result where it succeeded or is no JSON', async () => {
    expect([
      await answeredWith(answeredJson(200, { ok: false, error: 'channel_not_found' }), { failureCodes }),
      await answeredWith(answeredJson(200, { ok: true, url: 'wss://socket.example.com' }), { failureCodes }),
      await answeredWith(() => new Response('invalid_auth', { status: 200 }), { failureCodes }),
      await answeredWith(answeredEmpty(204), { failureCodes }),
    ]).toEqual([
      { kind: 'answered', outcome: 'tool_error' },
      { kind: 'answered', outcome: 'result', answer: { ok: true, url: 'wss://socket.example.com' } },
      { kind: 'answered', outcome: 'result', answer: 'invalid_auth' },
      { kind: 'answered', outcome: 'result' },
    ]);
  });

  it('is read as before where no codes are given', async () => {
    expect(await answeredWith(answeredJson(200, { ok: false, error: 'invalid_auth' }))).toEqual({
      kind: 'answered',
      outcome: 'result',
      answer: { ok: false, error: 'invalid_auth' },
    });
  });
});
