import { describe, expect, it } from 'vitest';

import { pendingCookieOf } from './pending-sign-in.ts';

const pending = { state: 'the-state', nonce: 'the-nonce', codeVerifier: 'the-verifier' };

describe('the pending sign-in a browser holds', () => {
  it('is read back as it was written, with the client it began as where it notes one, and nothing else is read as one', () => {
    const [withoutItsClient, notingItsClient] = [pendingCookieOf(false), pendingCookieOf(true)];
    const noted = { ...pending, clientId: 'client-1' };

    expect([
      withoutItsClient.pendingIn(withoutItsClient.valueOf(pending)),
      notingItsClient.pendingIn(notingItsClient.valueOf(noted)),
      withoutItsClient.pendingIn('not.a-pending'),
      notingItsClient.pendingIn(withoutItsClient.valueOf(pending)),
    ]).toEqual([pending, noted, undefined, undefined]);
  });
});
