import type { ProviderList } from '@on.auto/providers';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  acted,
  added,
  appKey,
  asTheApp,
  bothTypes,
  connected,
  decided,
  keptAfter,
  key,
  linkOf,
  ofTheConnection,
  registryAfter,
  said,
  signingIn,
  signingInUnderItsOwnClient,
  started,
  type Choice,
} from '../testing/way-choices.ts';
import type { ConnectionCommand } from './connection-commands.ts';
import type { RecordedConnectionEvent } from './connection-events.ts';
import { asItConnects } from './kept-next-ways.ts';
import { registryDeciderOf } from './registry-decider.ts';
import { clientSecretsHeldBy } from './registry.ts';

type RecordedCredential = Choice['credential'];

interface Case<Outcome> extends Choice {
  readonly name: string;
  readonly providers: ProviderList;
  readonly facts: readonly RecordedConnectionEvent[];
  readonly outcome: Outcome;
}

const fromTheProvider = { providers: bothTypes, facts: [added('tracker', key), linkOf('a1b2')] } as const;

const ofTheAppKey = { providers: bothTypes, facts: [added('tracker', appKey), linkOf('a1b2')] } as const;

const fromAKeyConnected = { providers: bothTypes, facts: [...fromTheProvider.facts, ...connected] } as const;

const fromTheAppKeyConnected = { providers: bothTypes, facts: [...ofTheAppKey.facts, ...connected] } as const;

function nextWay(credential: RecordedCredential, more: Readonly<Record<string, unknown>> = {}) {
  return [
    { type: 'connection_next_way_chosen', data: { ...ofTheConnection, credential, says: said, ...more } },
  ] as const;
}

const throughTheNewerLink = { token_sha256: 'c3d4' } as const;

const chosenNext: readonly Case<readonly unknown[]>[] = [
  {
    name: 'another way, with no account type where it acts as the app',
    ...fromAKeyConnected,
    ...throughTheNewerLink,
    credential: appKey,
    outcome: nextWay(appKey),
  },
  {
    name: 'another way, as a personal account where none is given',
    ...fromTheAppKeyConnected,
    ...throughTheNewerLink,
    credential: key,
    outcome: nextWay(key, { account_type: 'personal' }),
  },
  {
    name: 'its own way as another account type, with the credential it holds',
    ...fromAKeyConnected,
    ...throughTheNewerLink,
    credential: { kind: 'secret', permissions: 'delegated' },
    account_type: 'service',
    outcome: nextWay(key, { account_type: 'service' }),
  },
  {
    name: 'its own way with other values, keeping its account type',
    ...fromAKeyConnected,
    ...throughTheNewerLink,
    credential: key,
    placeholders: { site: 'globex' },
    outcome: nextWay(key, { account_type: 'personal', placeholders: { site: 'globex' } }),
  },
  {
    name: 'nothing for its own way, values and type',
    ...fromAKeyConnected,
    ...throughTheNewerLink,
    credential: key,
    outcome: [],
  },
];

describe('choosing the way a connection that has connected connects next', () => {
  it.each(chosenNext)('records $name', ({ name: _name, providers, facts, outcome, ...choice }) => {
    expect(decided(providers, facts, choice)).toEqual(outcome);
  });

  it('records nothing for the way chosen for it already, which acts as the app, chosen again', () => {
    const { providers, facts } = fromAKeyConnected;

    expect(
      decided(providers, [...facts, chosenNextFact(appKey)], { credential: appKey, ...throughTheNewerLink }),
    ).toEqual([]);
  });
});

function chosenNextFact(credential: RecordedCredential, more: Readonly<Record<string, unknown>> = {}) {
  const [{ type, data }] = nextWay(credential, more);
  return { type, data, context: acted } as const;
}

const ownClient: RecordedCredential = { ...signingIn, client_source: 'own' };

const underItsOwnClient: readonly RecordedConnectionEvent[] = [
  ...signingInUnderItsOwnClient,
  { type: 'connection_approved', data: ofTheConnection, context: acted },
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      secret_id: 'secret-1',
      client_id: 'org-app',
      client_source: 'own',
      connected_by: { id: 'person:ada', name: 'Ada' },
    },
    context: acted,
  },
  linkOf('c3d4'),
];

const anotherClientGiven: RecordedConnectionEvent = {
  type: 'connection_client_given',
  data: { ...ofTheConnection, client_id: 'org-app-2', secret_id: 's-3' },
  context: acted,
};

const startedAgain: RecordedConnectionEvent = {
  type: 'connection_consent_started',
  data: { ...started, client_id: 'org-app-2', state_sha256: 'f6a7', verifier_secret_id: 'secret-5' },
  context: acted,
};

describe('a connection that has connected, with a way chosen for its next connecting', () => {
  it('keeps the way it serves through, and is read through its link as the way chosen', () => {
    const kept = keptAfter(bothTypes, [...fromAKeyConnected.facts, chosenNextFact(appKey)]);

    expect([kept.connection.credential, kept.connection.status, kept.secretId]).toEqual([key, 'connected', 'secret-1']);
    expect(asItConnects(kept)).toMatchObject({
      connection: { credential: appKey, account_type: null, status: 'connected', placeholders: { site: 'acme' } },
      secretId: undefined,
    });
  });

  it('holds what the sign-in of the way chosen gives as that way’s own, beside the client it runs under', () => {
    const kept = keptAfter(bothTypes, [
      ...underItsOwnClient,
      chosenNextFact(ownClient),
      anotherClientGiven,
      startedAgain,
    ]);

    expect([kept.clientSecretId, kept.consent, kept.nextWay?.clientSecretId, clientSecretsHeldBy(kept)]).toEqual([
      's-2',
      undefined,
      's-3',
      ['s-2', 's-3'],
    ]);
    expect(asItConnects(kept)).toMatchObject({
      connection: { credential: { client_id: 'org-app-2', client_source: 'own' } },
      consent: { state_sha256: 'f6a7', client_id: 'org-app-2' },
      clientSecretId: 's-3',
    });
  });

  it('keeps the client it runs under for its own way as another account type', () => {
    const asItRuns = { ...ownClient, client_id: 'org-app' };
    const kept = keptAfter(bothTypes, [...underItsOwnClient, chosenNextFact(asItRuns, { account_type: 'service' })]);

    expect([kept.nextWay?.clientSecretId, kept.nextWay?.account_type, kept.connection.account_type]).toEqual([
      's-2',
      'service',
      'personal',
    ]);
  });
});

function decidedOn(providers: ProviderList, facts: readonly RecordedConnectionEvent[], command: ConnectionCommand) {
  return Result.getOrThrow(registryDeciderOf(providers).decide(command, registryAfter(providers, facts)));
}

const connectedBy = { id: 'person:grace', name: 'Grace Hopper' };

const approving = {
  type: 'approve',
  ...ofTheConnection,
  token_sha256: 'c3d4',
  connected_by: connectedBy,
  ...acted,
} as const;

const giving = { ...approving, type: 'give', secret_id: 'secret-6' } as const;

const byHandConnected = {
  providers: providerListOf(),
  facts: [added(null, signingIn, [signingIn, asTheApp]), linkOf('a1b2'), ...connected],
} as const;

const takenAsItConnects: readonly {
  readonly name: string;
  readonly providers: ProviderList;
  readonly facts: readonly RecordedConnectionEvent[];
  readonly command: ConnectionCommand;
  readonly taken: Readonly<Record<string, unknown>>;
}[] = [
  {
    name: 'a way that takes no credential, approved',
    providers: bothTypes,
    facts: [...fromAKeyConnected.facts, chosenNextFact({ kind: 'none' })],
    command: approving,
    taken: { credential: { kind: 'none' }, says: {}, placeholders: { site: 'acme' }, base_url: null },
  },
  {
    name: 'a key as a service account, given, at the address chosen',
    providers: bothTypes,
    facts: [
      ...fromTheAppKeyConnected.facts,
      chosenNextFact(key, { account_type: 'service', base_url: 'https://eu.tracker.example.com' }),
    ],
    command: giving,
    taken: {
      credential: key,
      account_type: 'service',
      says: {},
      placeholders: { site: 'acme' },
      base_url: 'https://eu.tracker.example.com',
    },
  },
  {
    name: 'the app of a server given by hand, given its client secret',
    ...byHandConnected,
    facts: [...byHandConnected.facts, chosenNextFact(asTheApp)],
    command: giving,
    taken: { credential: asTheApp, says: {}, base_url: null },
  },
];

describe('a way chosen for the next connecting, as it connects', () => {
  it.each(takenAsItConnects)(
    'is taken as its way in the decision that connects it: $name',
    ({ providers, facts, command, taken }) => {
      const decision = decidedOn(providers, facts, command);
      const kept = keptAfter(providers, [...facts, ...decision.map((fact) => ({ ...fact, context: acted }))]);

      expect(decision.map(({ type }) => type)).toEqual([
        'connection_way_chosen',
        'connection_approved',
        'connection_connected',
      ]);
      expect(decision[0]?.data).toEqual({ ...ofTheConnection, ...taken });
      expect([kept.nextWay, kept.connection.credential, kept.connection.status]).toEqual([
        undefined,
        taken['credential'],
        'connected',
      ]);
    },
  );
});
