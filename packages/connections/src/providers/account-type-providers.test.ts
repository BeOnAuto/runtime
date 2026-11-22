import { drive } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { waysListedOf } from '../testing/listed-ways.ts';

function driveWith(declared: Readonly<Record<string, unknown>>) {
  return { ...drive, credentials: drive.credentials.map((way) => ({ ...way, ...declared })) };
}

describe('what a connection made through a listed way acts as', () => {
  it.each([
    [{}, ['delegated', ['service', 'personal']]],
    [{ account_types: ['personal'] }, ['delegated', ['personal']]],
    [{ permissions: 'application' }, ['application', undefined]],
  ] as const)('is said of a way that declares %o as %o', async (declared, acting) => {
    const [way] = await waysListedOf(driveWith(declared));

    expect([way?.['permissions'], way?.['account_types']]).toEqual(acting);
  });

  it('is said of client credentials as the app, and nothing of a way that sends no credential', async () => {
    const ways = [
      ...(await waysListedOf({ ...drive, credentials: [{ kind: 'none' }] })),
      ...(await waysListedOf({
        ...drive,
        credentials: [{ kind: 'client_credentials', issuer: 'https://accounts.drive.example.com' }],
      })),
    ];

    expect(ways.map((way) => [way['kind'], way['permissions'], way['account_types']])).toEqual([
      ['none', undefined, undefined],
      ['client_credentials', 'application', undefined],
    ]);
  });
});
