import type { AccountType, ProviderList } from '@on.auto/providers';
import { providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedCredential } from './acting-fields.ts';
import type { ConnectionAdded, RecordedConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';
import { accountTypesTakenBy, wayOfTheConnection } from './what-connections-act-as.ts';

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ofTheConnection = { connection: 'connection-1' };

const key: RecordedCredential = { kind: 'secret', permissions: 'delegated', name: 'Authorization', in: 'header' };

const appKey: RecordedCredential = { ...key, permissions: 'application' };

const issuer = 'https://auth.tracker.example.com';

const signingIn: RecordedCredential = { kind: 'authorization', permissions: 'delegated', issuer, clients: ['dynamic'] };

const asTheApp: RecordedCredential = { kind: 'client_credentials', permissions: 'application', issuer };

function added(
  provider: string | null,
  credential: RecordedCredential,
  ways?: readonly RecordedCredential[],
): ConnectionAdded {
  return {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'tracker',
      server_type: 'mcp',
      provider,
      placeholders: provider === null ? null : { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
      credential,
      ...(ways === undefined ? {} : { ways }),
      account_type: 'personal',
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  };
}

function linkOf(token: string): RecordedConnectionEvent {
  return {
    type: 'connection_link_issued',
    data: { ...ofTheConnection, token_sha256: token },
    context: acted,
  };
}

const connected: readonly RecordedConnectionEvent[] = [
  { type: 'connection_approved', data: ofTheConnection, context: acted },
  {
    type: 'connection_connected',
    data: { ...ofTheConnection, secret_id: 'secret-1', connected_by: { id: 'person:ada', name: 'Ada' } },
    context: acted,
  },
  linkOf('c3d4'),
];

const [aKey, noCredential] = tracker.credentials;

function trackerWith(...ways: readonly unknown[]): ProviderList {
  return providerListOf(providerOf({ ...tracker, credentials: ways }));
}

const personalOnly = trackerWith({ ...aKey, account_types: ['personal'] }, { ...aKey, permissions: 'application' });

const bothTypes = trackerWith(aKey, { ...aKey, permissions: 'application' }, noCredential);

const said = { read: 'Read the issues.' };

interface Choice {
  readonly credential: RecordedCredential;
  readonly account_type?: AccountType;
  readonly token_sha256?: string;
  readonly by?: string;
}

interface Case<Outcome> extends Choice {
  readonly name: string;
  readonly providers: ProviderList;
  readonly facts: readonly RecordedConnectionEvent[];
  readonly outcome: Outcome;
}

function registryAfter(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  const decider = registryDeciderOf(providers);
  return facts.reduce((state, fact) => decider.evolve(state, fact), decider.initialState);
}

function decided(providers: ProviderList, facts: readonly RecordedConnectionEvent[], choice: Choice) {
  const command = {
    type: 'choose_way',
    ...ofTheConnection,
    token_sha256: 'a1b2',
    bindsPerson: true,
    says: said,
  } as const;
  const decision = registryDeciderOf(providers).decide(
    { ...command, ...acted, ...choice },
    registryAfter(providers, facts),
  );
  return Result.isSuccess(decision) ? decision.success : decision.failure;
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
    name: 'a connection connected since, through a newer link',
    ...fromTheProvider,
    facts: [...fromTheProvider.facts, ...connected],
    credential: appKey,
    token_sha256: 'c3d4',
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'another token',
    ...fromTheProvider,
    credential: appKey,
    token_sha256: 'e5f6',
    outcome: { _tag: 'not_found' },
  },
  {
    name: 'another person',
    ...fromTheProvider,
    credential: appKey,
    by: 'person:grace',
    outcome: { _tag: 'forbidden' },
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

function keptAfter(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  return Option.getOrThrow(Option.fromNullishOr(registryAfter(providers, facts).get('connection-1')));
}

const started = {
  ...ofTheConnection,
  state_sha256: 'd4e5',
  verifier_secret_id: 'secret-3',
  client_id: 'org-app',
  client_source: 'own',
  expires_at: '2026-10-15T14:10:00.000Z',
  says: {},
} as const;

const signingInUnderItsOwnClient: readonly RecordedConnectionEvent[] = [
  added('tracker', { ...signingIn, client_source: 'own' }),
  linkOf('a1b2'),
  {
    type: 'connection_client_given',
    data: { ...ofTheConnection, client_id: 'org-app', secret_id: 's-2' },
    context: acted,
  },
  { type: 'connection_consent_started', data: started, context: acted },
];

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
