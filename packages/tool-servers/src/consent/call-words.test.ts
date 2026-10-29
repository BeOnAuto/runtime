import { describe, expect, it } from 'vitest';

import { callWordsOf, waitWordsOf } from './call-words.ts';
import type { ConsentCall, ConsentCallAnswer, ConsentStep } from './consent-client.ts';

const host = 'auth.files.example.com';

function callOf(step: ConsentStep, answer: ConsentCallAnswer): ConsentCall {
  return { step, host, answer };
}

function answered(status: number, retryAfterMs: number | null = null): ConsentCallAnswer {
  return { status, retryAfterMs };
}

function wordsOf(calls: readonly ConsentCall[]): readonly string[] {
  return calls.map((call) => callWordsOf(call));
}

function waitsOf(calls: readonly ConsentCall[]): readonly string[] {
  return calls.map((call) => waitWordsOf(call));
}

describe('the words of a call of a consent that did not go as it should', () => {
  it('name the host, the step and the status the host answered', () => {
    expect(
      wordsOf([
        callOf('ping', answered(503)),
        callOf('resource_metadata', answered(500)),
        callOf('authorization_server_metadata', answered(502)),
        callOf('registration', answered(429)),
        callOf('token', answered(400)),
      ]),
    ).toEqual([
      `${host} answered the request sent without a token with HTTP 503`,
      `${host} answered the read of its protected resource metadata with HTTP 500`,
      `${host} answered the read of its authorization server metadata with HTTP 502`,
      `${host} answered the registration of a client with HTTP 429`,
      `${host} answered a request to its token endpoint with HTTP 400`,
    ]);
  });

  it('name how the call failed where the host gave no answer the consent can take', () => {
    expect(
      wordsOf([
        callOf('registration', { failed: 'timed_out' }),
        callOf('registration', { failed: 'unreachable' }),
        callOf('registration', { failed: 'unreadable' }),
        callOf('registration', { failed: 'failing' }),
      ]),
    ).toEqual([
      `${host} did not answer the registration of a client in time`,
      `${host} could not be reached for the registration of a client`,
      `${host} answered the registration of a client with a document this runtime cannot read`,
      `${host} did not answer the registration of a client`,
    ]);
  });
});

describe('the wait a call of a consent names', () => {
  it('is the one the host named, in seconds below two minutes, minutes below two hours, and hours up to the day a wait is read to, or a moment where it named none', () => {
    expect(
      waitsOf([
        callOf('registration', answered(429, 600_000)),
        callOf('registration', answered(429, 119_000)),
        callOf('registration', answered(429, 1)),
        callOf('registration', answered(429, 0)),
        callOf('registration', answered(429, 125_000)),
        callOf('registration', answered(429, 7_200_000)),
        callOf('registration', answered(429, 86_400_000)),
        callOf('registration', answered(429)),
        callOf('registration', { failed: 'timed_out' }),
      ]),
    ).toEqual([
      'try again in 10 minutes',
      'try again in 119 seconds',
      'try again in 1 second',
      'try again in 1 second',
      'try again in 3 minutes',
      'try again in 2 hours',
      'try again in 24 hours',
      'try again in a moment',
      'try again in a moment',
    ]);
  });
});
