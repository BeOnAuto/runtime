import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { drive } from '../testing/fixture-providers.ts';

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

function refused(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(provider, given)));
}

const [consent] = drive.credentials;

const readingAlone = {
  ...consent,
  scope: 'files.read',
  says: { 'files.read': 'Read the files of the account.' },
  description: 'Sign in to Drive and allow Auto to read your files.',
};

const twoConsents = decodedEntry({ ...drive, credentials: [consent, readingAlone, { kind: 'none' }] });

describe('the way an addition takes of a provider with two ways of one kind', () => {
  it('takes the first where the caller names the kind alone, and the one whose scopes the caller names, in any order', () => {
    expect([
      resolved(twoConsents, {}).credential.scope,
      resolved(twoConsents, { kind: 'authorization' }).credential.scope,
      resolved(twoConsents, { kind: 'authorization', scope: 'files.read' }).credential.scope,
      resolved(twoConsents, { kind: 'authorization', scope: 'files.write files.read' }).credential.scope,
      resolved(twoConsents, { scope: 'files.read' }).credential.scope,
    ]).toEqual([
      'files.read files.write',
      'files.read files.write',
      'files.read',
      'files.read files.write',
      'files.read',
    ]);
  });

  it('carries the words of the way it takes', () => {
    expect(resolved(twoConsents, { kind: 'authorization', scope: 'files.read' }).says).toEqual({
      'files.read': 'Read the files of the account.',
    });
  });

  it('takes the first of the kind the caller can be given', () => {
    const readingOnly = { canBeGiven: ({ scope }: { readonly scope?: string }) => scope === 'files.read' };

    expect(resolved(twoConsents, { kind: 'authorization', ...readingOnly }).credential.scope).toBe('files.read');
  });
});

describe('the way a caller names of a provider with two ways of one kind', () => {
  it('refuses a scope no way of the kind asks, naming the scopes its ways ask, and names each kind once', () => {
    expect([
      refused(twoConsents, { kind: 'authorization', scope: 'files.write' }),
      refused(twoConsents, { scope: 'files.write' }),
      refused(twoConsents, { kind: 'secret' }),
    ]).toEqual([
      [
        {
          pointer: '/credential/scope',
          detail:
            'The provider drive takes no authorization credential that asks files.write; it takes one that asks files.read files.write or one that asks files.read',
        },
      ],
      [
        {
          pointer: '/credential/scope',
          detail:
            'The provider drive takes no credential that asks files.write; it takes one that asks files.read files.write, one that asks files.read, or one that asks no scope',
        },
      ],
      [
        {
          pointer: '/credential/kind',
          detail: 'The provider drive takes no secret credential; it takes authorization or none',
        },
      ],
    ]);
  });
});
