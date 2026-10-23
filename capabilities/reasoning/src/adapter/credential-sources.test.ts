import { describe, expect, it } from 'vitest';

import { googleAccessTokens, guarded } from './credential-sources.ts';
import { OutboundFailure } from './outbound-failure.ts';

describe('guarded', () => {
  it('passes a credential through', async () => {
    await expect(guarded(() => Promise.resolve('credential'))()).resolves.toBe('credential');
  });

  it('replaces any failure with one that carries nothing from it', async () => {
    const lookup = guarded(() => Promise.reject(new Error('token endpoint said SECRET')));

    await expect(lookup()).rejects.toEqual(new OutboundFailure('credential_lookup_failed'));
  });
});

describe('googleAccessTokens', () => {
  it('gives the token of the client', async () => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve('ya29.token') })()).resolves.toBe(
      'ya29.token',
    );
  });

  it.each([null, undefined, ''])('fails when the client gives %j', async (token) => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve(token) })()).rejects.toBeInstanceOf(
      OutboundFailure,
    );
  });
});
