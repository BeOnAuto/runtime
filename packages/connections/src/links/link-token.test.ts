import { Caller } from '@on.auto/operations';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { ada } from '../testing/harness.ts';
import { issuedLink, linkLastsMs } from './link-token.ts';

function expiryOfALinkIssuedAt(now: number): Promise<string> {
  return Effect.runPromise(
    TestClock.setTime(now).pipe(
      Effect.andThen(issuedLink),
      Effect.map(({ expires_at: expiresAt }) => expiresAt),
      Effect.provideService(Caller, ada),
      Effect.provide(TestClock.layer()),
    ),
  );
}

describe('a link to connect a connection', () => {
  it.each([0, Date.UTC(2026, 9, 15, 14), Date.UTC(2026, 11, 31, 23, 30)])(
    'expires exactly as long as a link lasts after it was issued, at %i',
    async (now) => {
      expect(await expiryOfALinkIssuedAt(now)).toBe(new Date(now + linkLastsMs).toISOString());
    },
  );

  it('lasts 24 hours, as it ships', () => {
    expect(linkLastsMs).toBe(24 * 60 * 60 * 1000);
  });
});
