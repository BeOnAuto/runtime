import { describe, expect, it } from 'vitest';

import type { ConsentCallAnswer, UnansweredCall } from './consent-client.ts';
import { observedCalls } from './consent-failures.ts';

const endpoint = 'https://auth.files.example.com/register';

interface Seen {
  readonly refusal: UnansweredCall;
  readonly body: string;
}

async function answerSeen(response: () => Response): Promise<Seen> {
  const observed = observedCalls('registration', endpoint, () => Promise.resolve(response()));
  const answer = await observed.fetch(endpoint);
  return { refusal: observed.refusalOfTheAnswer(), body: await answer.text() };
}

function jsonOf(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function answersOf(seen: readonly Seen[]): readonly ConsentCallAnswer[] {
  return seen.map((one) => one.refusal.call.answer);
}

describe('the error code a call of a consent keeps', () => {
  it('is the OAuth error code a refusal names in its JSON body, with none of its description', async () => {
    const refused = { error: 'invalid_client_metadata', error_description: 'Clients are registered by hand' };

    const seen = await answerSeen(() => jsonOf(refused, 400));

    expect(seen.refusal).toEqual({
      refused: 'unanswered',
      call: {
        step: 'registration',
        host: 'auth.files.example.com',
        answer: { status: 400, retryAfterMs: null, errorCode: 'invalid_client_metadata' },
      },
    });
    expect(JSON.stringify(seen.refusal)).not.toContain('by hand');
    expect(seen.body).toBe(JSON.stringify(refused));
  });

  it('is kept beside the wait a refusal names, and read from no success', async () => {
    const seen = await Promise.all([
      answerSeen(() => jsonOf({ error: 'invalid_request' }, 201)),
      answerSeen(() => jsonOf({ error: 'slow_down' }, 429, { 'retry-after': '30' })),
    ]);

    expect(answersOf(seen)).toEqual([
      { failed: 'unreadable' },
      { status: 429, retryAfterMs: 30_000, errorCode: 'slow_down' },
    ]);
  });
});

describe('a call of a consent that keeps no error code', () => {
  it('is one whose body names none, is not JSON, names one no code is written as, is empty or is past the bound', async () => {
    const large = { error: 'invalid_client_metadata', padding: 'x'.repeat(20_000) };

    const seen = await Promise.all([
      answerSeen(() => jsonOf({ error_description: 'Refused' }, 400)),
      answerSeen(() => new Response('<html>Forbidden</html>', { status: 403 })),
      answerSeen(() => jsonOf({ error: 'not a code; see https://example.com' }, 400)),
      answerSeen(() => new Response(null, { status: 401 })),
      answerSeen(() => jsonOf(large, 400)),
    ]);

    expect(answersOf(seen)).toEqual([
      { status: 400, retryAfterMs: null },
      { status: 403, retryAfterMs: null },
      { status: 400, retryAfterMs: null },
      { status: 401, retryAfterMs: null },
      { status: 400, retryAfterMs: null },
    ]);
    expect(seen.at(-1)?.body).toBe(JSON.stringify(large));
  });
});
