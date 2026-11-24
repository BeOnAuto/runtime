import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  accountTypesOf,
  accountTypeWhereNoneIsGiven,
  permissionsOf,
  providerNamed,
  providersShippedRoots,
  readProviders,
} from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const takingASeparateUser = ['amazon-ads', 'amazon-ads-mcp', 'buffer', 'linear', 'posthog', 'stripe'];

function accountsTakenBy(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  return entry.credentials
    .filter((way) => permissionsOf(way) === 'delegated')
    .map((way) => [accountTypesOf(way), accountTypeWhereNoneIsGiven(accountTypesOf(way))]);
}

describe('the ways of the shipped apps that let a company add a separate user', () => {
  it('take a service account and the account of the person who connects, and the person’s own where none is given', () => {
    expect(takingASeparateUser.map((name) => accountsTakenBy(name))).toEqual(
      takingASeparateUser.map(() => [[['service', 'personal'], 'personal']]),
    );
  });
});

const connectingAsTheCompany = ['atlassian', 'onedrive', 'stripe', 'zoom'];

function waysAfterTheSignInOf(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  const [first, ...later] = entry.credentials;
  return [
    first?.kind,
    later.map((way) => [way.kind, permissionsOf(way), accountTypesOf(way), way.limitation !== undefined]),
  ];
}

describe('the ways of the shipped apps that connect as the company, after the sign-in', () => {
  it('come after the sign-in way, each acting as the app or as a service account alone, and each stating what it cannot do', () => {
    expect(connectingAsTheCompany.map((name) => waysAfterTheSignInOf(name))).toEqual([
      ['authorization', [['secret', 'delegated', ['service'], true]]],
      ['authorization', [['client_credentials', 'application', [], true]]],
      ['authorization', [['secret', 'application', [], true]]],
      [
        'authorization',
        [
          ['authorization', 'application', [], true],
          ['client_credentials', 'application', [], true],
        ],
      ],
    ]);
  });
});
