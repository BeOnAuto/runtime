import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, providerNamed, providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const signing = { kind: 'jwt_bearer' } as const;

describe('the way of gmail that signs an assertion', () => {
  it('still names the mailbox given as the account the token is asked for, and is refused without one', () => {
    const { entry } = Result.getOrThrow(providerNamed(shipped, 'gmail'));
    const given = { ...signing, placeholders: { mailbox: 'automation@acme.com' } };

    expect(Result.getOrThrow(additionOfProvider(entry, given)).credential).toEqual({
      kind: 'jwt_bearer',
      issuer: 'https://accounts.google.com',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      subject: 'automation@acme.com',
    });
    expect(Result.getOrThrow(Result.flip(additionOfProvider(entry, signing))).map(({ pointer }) => pointer)).toEqual([
      '/placeholders/mailbox',
    ]);
  });
});
