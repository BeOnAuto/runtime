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

function answeredWith(answer: Answered): Promise<RequestedOnce> {
  return Effect.runPromise(bearerRequestOnce(renewing, sendingOver(answeringService(answer).fetch)));
}

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
