import { describe, expect, it } from 'vitest';

import { callWordsOf } from './call-words.ts';
import type { ConsentCall, ConsentCallAnswer, ConsentStep } from './consent-client.ts';

const host = 'auth.files.example.com';

function callOf(step: ConsentStep, answer: ConsentCallAnswer): ConsentCall {
  return { step, host, answer };
}

function answered(status: number, retryAfterMs: number | null = null): ConsentCallAnswer {
  return { status, retryAfterMs };
}

function wordsOf(calls: readonly ConsentCall[]) {
  return calls.map((call) => callWordsOf(call));
}

function waitsOf(calls: readonly ConsentCall[]) {
  return calls.map((call) => callWordsOf(call).wait);
}

describe('the words of a call of a consent the host answered as one that may be asked again', () => {
  it('name the host, the step and the status the host answered, with a wait, for a 5xx, a 429 and a 408', () => {
    expect(
      wordsOf([
        callOf('ping', answered(503)),
        callOf('resource_metadata', answered(500)),
        callOf('authorization_server_metadata', answered(502)),
        callOf('registration', answered(429, 600_000)),
        callOf('token', answered(408)),
      ]),
    ).toEqual([
      { told: `${host} answered the request sent without a token with HTTP 503`, wait: 'try again in a moment' },
      {
        told: `${host} answered the read of its protected resource metadata with HTTP 500`,
        wait: 'try again in a moment',
      },
      {
        told: `${host} answered the read of its authorization server metadata with HTTP 502`,
        wait: 'try again in a moment',
      },
      { told: `${host} answered the registration of a client with HTTP 429`, wait: 'try again in 10 minutes' },
      { told: `${host} answered a request to its token endpoint with HTTP 408`, wait: 'try again in a moment' },
    ]);
  });

  it('name how the call failed where the host gave no answer the consent can take, with a wait', () => {
    expect(
      wordsOf([
        callOf('registration', { failed: 'timed_out' }),
        callOf('registration', { failed: 'unreachable' }),
        callOf('registration', { failed: 'unreadable' }),
        callOf('registration', { failed: 'failing' }),
      ]),
    ).toEqual([
      { told: `${host} did not answer the registration of a client in time`, wait: 'try again in a moment' },
      { told: `${host} could not be reached for the registration of a client`, wait: 'try again in a moment' },
      {
        told: `${host} answered the registration of a client with a document this runtime cannot read`,
        wait: 'try again in a moment',
      },
      { told: `${host} did not answer the registration of a client`, wait: 'try again in a moment' },
    ]);
  });
});

describe('the words of a call of a consent the host refused with a 4xx', () => {
  it('say a registration is refused, with the error code the host named, and that an API key may connect the server instead', () => {
    expect(
      wordsOf([
        callOf('registration', { status: 400, retryAfterMs: null, errorCode: 'invalid_client_metadata' }),
        callOf('registration', answered(403)),
      ]),
    ).toEqual([
      {
        told: `${host} refuses to register a client (invalid_client_metadata); its sign-in is open only to clients it already knows; connect with an API key instead, if the server takes one`,
        wait: undefined,
      },
      {
        told: `${host} refuses to register a client; its sign-in is open only to clients it already knows; connect with an API key instead, if the server takes one`,
        wait: undefined,
      },
    ]);
  });

  it('say a read of the metadata is not served, with its status, and that the server may take an API key instead', () => {
    expect(
      wordsOf([
        callOf('resource_metadata', { status: 403, retryAfterMs: null, errorCode: 'access_denied' }),
        callOf('authorization_server_metadata', answered(401)),
      ]),
    ).toEqual([
      {
        told: `${host} does not serve its protected resource metadata (HTTP 403); the server may take an API key instead of a sign-in`,
        wait: undefined,
      },
      {
        told: `${host} does not serve its authorization server metadata (HTTP 401); the server may take an API key instead of a sign-in`,
        wait: undefined,
      },
    ]);
  });

  it('keep the words of the request sent without a token and of the token request, and name no wait', () => {
    expect(
      wordsOf([
        callOf('ping', answered(404)),
        callOf('token', { status: 401, retryAfterMs: 60_000, errorCode: 'invalid_client' }),
      ]),
    ).toEqual([
      { told: `${host} answered the request sent without a token with HTTP 404`, wait: undefined },
      { told: `${host} answered a request to its token endpoint with HTTP 401`, wait: undefined },
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
        callOf('registration', answered(503, 7_200_000)),
        callOf('registration', answered(503, 86_400_000)),
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
