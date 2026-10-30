import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { campaigns, drive } from '../testing/fixture-providers.ts';

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

function refused(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(provider, given)));
}

const [consent] = drive.credentials;

const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

const growing = decodedEntry({
  ...drive,
  credentials: [{ ...consent, more: [sharing] }, { kind: 'none' }],
});

describe('the way an addition takes of a provider with one way of each kind', () => {
  it('takes the way of the kind the caller names, the first where it names none, and refuses a kind the provider does not take', () => {
    expect([resolved(growing, {}).credential.kind, resolved(growing, { kind: 'none' }).credential.kind]).toEqual([
      'authorization',
      'none',
    ]);
    expect(refused(growing, { kind: 'secret' })).toEqual([
      {
        pointer: '/credential/kind',
        detail: 'The provider drive takes no secret credential; it takes authorization or none',
      },
    ]);
  });

  it('carries the scope, the parameters and the words of what the first consent asks, and nothing of what a later one may add', () => {
    const addition = resolved(growing, { kind: 'authorization' });

    expect(addition.credential).toEqual({
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      scope: 'files.read files.write',
      parameters: { access_type: 'offline', prompt: 'consent' },
    });
    expect(addition.says).toEqual(consent?.says);
  });
});

describe('the way an addition takes of a provider whose written-out server takes no PKCE', () => {
  it('carries its pkce beside its endpoints', () => {
    const [writtenOut] = campaigns.credentials;
    const unchallenged = decodedEntry({ ...campaigns, credentials: [{ ...writtenOut, pkce: 'none' }] });

    expect(resolved(unchallenged, { placeholders: { region: 'na' } }).credential).toMatchObject({
      authorization_endpoint: 'https://auth.campaigns.example.com/authorize',
      pkce: 'none',
    });
  });
});
