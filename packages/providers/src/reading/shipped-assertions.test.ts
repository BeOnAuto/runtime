import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  accountTypesOf,
  additionOfProvider,
  permissionsOf,
  providerNamed,
  providersShippedRoots,
  readProviders,
} from '../index.ts';

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

const actingAsTheServiceAccount = [
  'campaign-manager-360',
  'display-video-360',
  'google-ads',
  'google-analytics',
  'google-analytics-admin',
  'google-docs',
  'google-sheets',
  'google-slides',
  'youtube-analytics',
];

function waysOf(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  const [first, ...later] = entry.credentials;
  return [
    first?.kind,
    later
      .filter(({ kind }) => kind === 'jwt_bearer')
      .map((way) => [
        way.kind,
        permissionsOf(way),
        accountTypesOf(way),
        way.subject,
        Object.keys(way.placeholders ?? {}),
        way.limitation !== undefined,
      ]),
  ];
}

function addedBySigningAlone(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  return Result.getOrThrow(additionOfProvider(entry, signing)).credential;
}

function scopeOfTheSignIn(name: string): string | undefined {
  return Result.getOrThrow(providerNamed(shipped, name)).entry.credentials[0]?.scope;
}

describe('the ways of the Google apps that sign an assertion as the service account itself', () => {
  it('come after the sign-in way, each acting as the app, naming no account, asking no value of its own, and youtube-analytics alone stating what it cannot do', () => {
    expect(actingAsTheServiceAccount.map((name) => waysOf(name))).toEqual(
      actingAsTheServiceAccount.map((name) => [
        'authorization',
        [['jwt_bearer', 'application', [], undefined, [], name === 'youtube-analytics']],
      ]),
    );
  });

  it('are added by their kind alone, for a token for the service account itself, with the scope of the sign-in way', () => {
    expect(actingAsTheServiceAccount.map((name) => addedBySigningAlone(name))).toStrictEqual(
      actingAsTheServiceAccount.map((name) => ({
        kind: 'jwt_bearer',
        issuer: 'https://accounts.google.com',
        scope: scopeOfTheSignIn(name),
      })),
    );
  });
});
