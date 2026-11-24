import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { keyMadeAt, tracker } from '../testing/fixture-providers.ts';
import {
  accountTypeIssueOf,
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  identitiesOf,
  isTheWayAsked,
  permissionsOf,
  wayTakenWhereNoneIsNamed,
  type AccountType,
} from './account-types.ts';

const aKey = {
  kind: 'secret',
  in: 'header',
  name: 'Authorization',
  scheme: 'Bearer',
  description: 'Tracker key',
  ...keyMadeAt('app.tracker.example.com'),
} as const;

const aClient = { kind: 'client_credentials', issuer: 'https://auth.tracker.example.com' } as const;

const aSignIn = { kind: 'authorization', issuer: 'https://auth.tracker.example.com' } as const;

const nothing = { kind: 'none' } as const;

function refusedAtWith(ways: readonly unknown[]): readonly string[] {
  return problemsOf({ ...tracker, credentials: ways }).map(([path]) => path);
}

describe('what a way acts as', () => {
  it.each([
    [{ kind: 'secret' }, 'delegated', ['service', 'personal']],
    [{ kind: 'secret', permissions: 'application' }, 'application', []],
    [{ kind: 'secret', account_types: ['personal'] }, 'delegated', ['personal']],
    [{ kind: 'authorization', account_types: ['personal', 'service'] }, 'delegated', ['service', 'personal']],
    [{ kind: 'authorization', permissions: 'application', account_types: ['personal'] }, 'application', []],
    [{ kind: 'reference' }, 'delegated', ['service', 'personal']],
    [{ kind: 'client_credentials' }, 'application', []],
    [{ kind: 'client_credentials', permissions: 'delegated' }, 'application', []],
    [{ kind: 'none' }, undefined, []],
  ] as const)('%o has %s permissions and takes the account types %o', (way, permissions, taken) => {
    expect([permissionsOf(way), accountTypesOf(way)]).toEqual([permissions, taken]);
  });

  it.each([
    [['service', 'personal'], 'personal'],
    [['personal'], 'personal'],
    [['service'], 'service'],
    [[], undefined],
  ] as const)(
    'records %o as the account type of a connection whose caller gives none',
    (taken: readonly AccountType[], recorded) => {
      expect(accountTypeWhereNoneIsGiven(taken)).toBe(recorded);
    },
  );

  it.each([
    ['personal', ['personal'], 'undefined'],
    ['personal', ['service', 'personal'], 'undefined'],
    ['service', ['personal'], 'string'],
  ] as const)('answers an account type %s of a way that takes %o with an issue of type %s', (given, taken, issue) => {
    expect(typeof accountTypeIssueOf(given, taken)).toBe(issue);
  });

  it.each([
    [aKey, { kind: 'secret', permissions: 'delegated' }, true],
    [aKey, { kind: 'secret', permissions: 'application' }, false],
    [{ ...aKey, permissions: 'application' }, { kind: 'secret', permissions: 'application' }, true],
    [aKey, { kind: 'authorization', permissions: 'delegated' }, false],
    [aClient, { kind: 'client_credentials' }, true],
    [nothing, { kind: 'none' }, true],
  ] as const)('finds %o as the way of %o: %s', (way, asked, found) => {
    expect(isTheWayAsked(way, asked)).toBe(found);
  });
});

const aPersonsSignIn = { ...aSignIn, account_types: ['personal'] } as const;

const aSignInOfEither = { ...aSignIn, account_types: ['service', 'personal'] } as const;

const aServiceAccountsKey = { ...aKey, account_types: ['service'] } as const;

const anAppsKey = { ...aKey, permissions: 'application' } as const;

const aManagedServiceAccount = { kind: 'token_exchange', managed_service_account: true } as const;

const theCompanysServiceAccount = { kind: 'token_exchange' } as const;

describe('who a connection made through a way may act as', () => {
  it.each([
    [aManagedServiceAccount, ['managed_service_account']],
    [theCompanysServiceAccount, ['application']],
    [aClient, ['application']],
    [anAppsKey, ['application']],
    [aSignInOfEither, ['service', 'personal']],
    [aPersonsSignIn, ['personal']],
    [nothing, []],
  ] as const)('%o may act as %o', (way, identities) => {
    expect(identitiesOf(way)).toEqual(identities);
  });
});

type WayOfAShape = Parameters<typeof identitiesOf>[0];

type Shape = readonly (readonly [string, readonly WayOfAShape[], WayOfAShape | undefined, AccountType | undefined])[];

const shapes: Shape = [
  ['an app and a person, the app', [aPersonsSignIn, aClient], aClient, undefined],
  ['a service account and a person on one way, the service account', [aSignInOfEither], aSignInOfEither, 'service'],
  [
    'a person on one way and a service account on another, the service account',
    [aPersonsSignIn, aServiceAccountsKey],
    aServiceAccountsKey,
    'service',
  ],
  [
    "Auto's service account, the company's own and a person, Auto's",
    [aPersonsSignIn, theCompanysServiceAccount, aManagedServiceAccount],
    aManagedServiceAccount,
    undefined,
  ],
  ['a person only, the person', [aPersonsSignIn], aPersonsSignIn, 'personal'],
  ['two apps, the first listed', [anAppsKey, aClient], anAppsKey, undefined],
  ['a way with no credential and a person, the person', [nothing, aPersonsSignIn], aPersonsSignIn, 'personal'],
  ['a way with no credential alone, none', [nothing], undefined, undefined],
  ['no way, none', [], undefined, undefined],
];

describe('the way an addition that names no way takes', () => {
  it.each(shapes)('of %s', (_shape, ways, taken, accountType) => {
    const chosen = wayTakenWhereNoneIsNamed(ways);

    expect([chosen?.way, chosen?.accountType]).toEqual([taken, accountType]);
  });
});

describe('the permissions and the account types an entry states on a way', () => {
  it.each([
    [{ ...aKey, permissions: 'application' }, []],
    [{ ...aKey, account_types: ['service', 'personal'] }, []],
    [{ ...aSignIn, account_types: ['personal'] }, []],
    [{ ...aKey, permissions: 'application', account_types: ['personal'] }, ['/credentials/0/account_types']],
    [{ ...aSignIn, permissions: 'application', account_types: ['service'] }, ['/credentials/0/account_types']],
    [{ ...aKey, account_types: ['personal', 'personal'] }, ['/credentials/0/account_types/1']],
    [{ ...aKey, account_types: [] }, ['/credentials/0/account_types']],
    [{ ...aClient, permissions: 'application' }, ['/credentials/0/permissions']],
    [{ ...aClient, account_types: ['service'] }, ['/credentials/0/account_types']],
    [{ ...nothing, account_types: ['personal'] }, ['/credentials/0/account_types']],
  ] as const)('refuses %o at %o', (way, refused) => {
    expect(refusedAtWith([way])).toEqual(refused);
  });

  it('takes the page of a client, the label of its button and the steps of its page on a way of client credentials', () => {
    const steps = { key_page: { title: 'Register a client', instructions: 'Register a client for Auto.' } };

    expect(
      refusedAtWith([
        { ...aClient, key_page: 'https://app.tracker.example.com/clients', key_page_title: 'Register a client', steps },
      ]),
    ).toEqual([]);
  });
});

describe('the ways of one kind in an entry', () => {
  it.each([
    [[aKey, aKey], ['/credentials/1/kind']],
    [[aKey, { ...aKey, permissions: 'delegated' }], ['/credentials/1/kind']],
    [[aKey, { ...aKey, permissions: 'application' }], []],
    [
      [
        { ...aKey, permissions: 'application' },
        { ...aKey, permissions: 'application' },
      ],
      ['/credentials/1/kind'],
    ],
    [[aSignIn, { ...aSignIn, permissions: 'application' }, aKey], []],
  ] as const)('of %o are refused at %o', (ways, refused) => {
    expect(refusedAtWith(ways)).toEqual(refused);
  });
});
