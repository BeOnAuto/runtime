import { describe, expect, it } from 'vitest';

import { unansweredWordsOf } from './unanswered-words.ts';

const lead = 'The consent of the connection files cannot go on';

const host = 'auth.files.example.com';

describe('the words of a consent a server did not answer as it asks', () => {
  it('lead with the refusal and the call, and name no wait, where the host refused with a 4xx', () => {
    expect([
      unansweredWordsOf(lead, {
        step: 'registration',
        host,
        answer: { status: 400, retryAfterMs: null, errorCode: 'invalid_client_metadata' },
      }),
      unansweredWordsOf(lead, { step: 'resource_metadata', host, answer: { status: 403, retryAfterMs: null } }),
    ]).toEqual([
      `${lead}: ${host} refuses to register a client (invalid_client_metadata); its sign-in is open only to clients it already knows; connect with an API key instead, if the server takes one`,
      `${lead}: ${host} does not serve its protected resource metadata (HTTP 403); the server may take an API key instead of a sign-in`,
    ]);
  });

  it('end with the wait where the host may answer later, or where no server answered at all', () => {
    expect([
      unansweredWordsOf(lead, { step: 'registration', host, answer: { status: 429, retryAfterMs: 30_000 } }),
      unansweredWordsOf(lead, { step: 'registration', host, answer: { status: 503, retryAfterMs: null } }),
      unansweredWordsOf(lead, { step: 'registration', host, answer: { failed: 'unreachable' } }),
      unansweredWordsOf(lead),
    ]).toEqual([
      `${lead}: ${host} answered the registration of a client with HTTP 429; try again in 30 seconds`,
      `${lead}: ${host} answered the registration of a client with HTTP 503; try again in a moment`,
      `${lead}: ${host} could not be reached for the registration of a client; try again in a moment`,
      `${lead}: a server it asks did not answer; try again in a moment`,
    ]);
  });
});
