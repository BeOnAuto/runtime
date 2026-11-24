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

const connectingAsTheCompany = ['atlassian', 'linear', 'onedrive', 'stripe', 'zoom'];

const signingIn = ['authorization', 'delegated', ['service', 'personal'], false];

const signingInAsAPerson = ['authorization', 'delegated', ['personal'], false];

function waysOfTheCompanyOf(name: string) {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  return entry.credentials.map((way) => [way.kind, permissionsOf(way), accountTypesOf(way), 'limitation' in way]);
}

describe('the ways of the shipped apps that connect as the company', () => {
  it('are a way acting as the app or as a service account alone that states what it cannot do, beside the sign-in, Linear’s written first', () => {
    expect(connectingAsTheCompany.map((name) => waysOfTheCompanyOf(name))).toEqual([
      [signingInAsAPerson, ['secret', 'delegated', ['service'], true]],
      [['client_credentials', 'application', [], true], signingIn],
      [signingIn, ['client_credentials', 'application', [], true]],
      [signingIn, ['secret', 'application', [], true]],
      [signingInAsAPerson, ['authorization', 'application', [], true], ['client_credentials', 'application', [], true]],
    ]);
  });
});
