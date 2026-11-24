import type { AccountType, ProviderList } from '@on.auto/providers';
import { providerListOf } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import {
  acted,
  added,
  aKey,
  appKey,
  asTheApp,
  bothTypes,
  decided,
  keptAfter,
  key,
  linkOf,
  ofTheConnection,
  said,
  signingIn,
  signingInUnderItsOwnClient,
  trackerWith,
  type Choice,
} from '../testing/way-choices.ts';
import type { RecordedCredential } from './acting-fields.ts';
import type { RecordedConnectionEvent } from './connection-events.ts';
import { accountTypesTakenBy, wayOfTheConnection } from './what-connections-act-as.ts';

const personalOnly = trackerWith({ ...aKey, account_types: ['personal'] }, { ...aKey, permissions: 'application' });

interface Case<Outcome> extends Choice {
  readonly name: string;
  readonly providers: ProviderList;
  readonly facts: readonly RecordedConnectionEvent[];
  readonly outcome: Outcome;
}

const fromTheProvider = { providers: bothTypes, facts: [added('tracker', key), linkOf('a1b2')] } as const;

const ofTheAppKey = { providers: bothTypes, facts: [added('tracker', appKey), linkOf('a1b2')] } as const;

const byHand = {
  providers: providerListOf(),
  facts: [added(null, signingIn, [signingIn, asTheApp]), linkOf('a1b2')],
} as const;

function wayChosen(credential: RecordedCredential, accountType?: AccountType) {
  const acting = accountType === undefined ? {} : { account_type: accountType };
  return [{ type: 'connection_way_chosen', data: { ...ofTheConnection, credential, ...acting, says: said } }] as const;
}

const recorded: readonly Case<readonly unknown[]>[] = [
  { name: 'the app’s key, as no account', ...fromTheProvider, credential: appKey, outcome: wayChosen(appKey) },
  {
    name: 'a way that acts as an account, as the type given',
    ...ofTheAppKey,
    providers: personalOnly,
    credential: key,
    account_type: 'personal',
    outcome: wayChosen(key, 'personal'),
  },
  {
    name: 'a way of an account, as a personal one',
    ...ofTheAppKey,
    credential: key,
    outcome: wayChosen(key, 'personal'),
  },
  { name: 'the app of a server given by hand', ...byHand, credential: asTheApp, outcome: wayChosen(asTheApp) },
  {
    name: 'the account type given for the way it has, where it differs',
    ...fromTheProvider,
    credential: key,
    account_type: 'service',
    outcome: [{ type: 'connection_account_type_set', data: { ...ofTheConnection, account_type: 'service' } }],
  },
  { name: 'nothing for its way and type', ...fromTheProvider, credential: key, account_type: 'personal', outcome: [] },
  { name: 'nothing for its way, given no type', ...fromTheProvider, credential: key, outcome: [] },
];

const notOffered = { _tag: 'invalid_input', issues: [{ pointer: '/credential' }] } as const;

const typeNotTaken = { _tag: 'invalid_input', issues: [{ pointer: '/account_type' }] } as const;

const gone = providerListOf();

const refused: readonly Case<Readonly<Record<string, unknown>>>[] = [
  { name: 'a kind its provider does not offer', ...fromTheProvider, credential: signingIn, outcome: notOffered },
  { name: 'a way of a provider gone', ...fromTheProvider, providers: gone, credential: appKey, outcome: notOffered },
  { name: 'a kind its server does not offer', ...byHand, credential: key, outcome: notOffered },
  {
    name: 'a way a server that named one way does not offer',
    providers: gone,
    facts: [added(null, signingIn), linkOf('a1b2')],
    credential: asTheApp,
    outcome: notOffered,
  },
  {
    name: 'an account type the way does not take',
    ...fromTheProvider,
    providers: personalOnly,
    credential: key,
    account_type: 'service',
    outcome: typeNotTaken,
  },
  { name: 'a type of the app', ...fromTheProvider, credential: appKey, account_type: 'service', outcome: typeNotTaken },
  {
    name: 'another token',
    ...fromTheProvider,
    credential: appKey,
    token_sha256: 'e5f6',
    outcome: { _tag: 'not_found' },
  },
];

describe('choosing the way a pending connection connects', () => {
  it.each(recorded)('records $name', ({ name: _name, providers, facts, outcome, ...choice }) => {
    expect(decided(providers, facts, choice)).toEqual(outcome);
  });

  it.each(refused)('refuses $name', ({ name: _name, providers, facts, outcome, ...choice }) => {
    expect(decided(providers, facts, choice)).toMatchObject(outcome);
  });
});

function chosen(credential: RecordedCredential, accountType?: AccountType): RecordedConnectionEvent {
  const acting = accountType === undefined ? {} : { account_type: accountType };
  return {
    type: 'connection_way_chosen',
    data: { ...ofTheConnection, credential, ...acting, says: { 'files.read': 'Read the files.' } },
    context: acted,
  };
}

describe('a connection whose way was chosen, as the stream folds it', () => {
  it('holds the credential and the account type chosen, the scopes of the way, and its link', () => {
    const credential = { ...signingIn, scope: 'files.read' };

    expect(keptAfter(bothTypes, [...fromTheProvider.facts, chosen(credential, 'service')])).toMatchObject({
      connection: {
        credential,
        account_type: 'service',
        asked_scopes: [{ name: 'files.read', says: 'Read the files.' }],
        status: 'pending',
      },
      link: { token_sha256: 'a1b2' },
    });
    expect(keptAfter(bothTypes, [...fromTheProvider.facts, chosen(appKey)]).connection.account_type).toBeNull();
  });

  it('drops a sign-in started and an OAuth client given for the way before', () => {
    expect(keptAfter(bothTypes, [...signingInUnderItsOwnClient, chosen(appKey)])).toMatchObject({
      consent: undefined,
      clientSecretId: undefined,
      nextClient: undefined,
    });
  });

  it('finds the way chosen among its provider’s ways, with the account types that way takes', () => {
    const facts = [added('tracker', appKey), linkOf('a1b2'), chosen(key, 'personal')];
    const { connection } = keptAfter(personalOnly, facts);

    expect([wayOfTheConnection(connection, personalOnly), accountTypesTakenBy(connection, personalOnly)]).toEqual([
      { ...aKey, account_types: ['personal'] },
      ['personal'],
    ]);
  });
});
