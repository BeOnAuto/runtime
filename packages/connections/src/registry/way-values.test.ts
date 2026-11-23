import { mail, providerListOf, providerOf } from '@on.auto/providers/testing';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedCredential } from './acting-fields.ts';
import {
  ConnectionEventSchema,
  type ConnectionAdded,
  type RecordedConnectionEvent,
  type WayChosen,
} from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const providers = providerListOf(providerOf(mail));

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ofTheConnection = { connection: 'connection-1' };

const values = { tenant: '0a1b2c3d', mailbox: 'robot@acme.example.com' };

const atTheMailbox = 'https://api.mail.example.com/v1/mailboxes/robot@acme.example.com';

const asTheApp: RecordedCredential = {
  kind: 'client_credentials',
  permissions: 'application',
  issuer: 'https://login.mail.example.com/0a1b2c3d',
  scope: 'mail.all',
};

const signingIn: RecordedCredential = {
  kind: 'authorization',
  permissions: 'delegated',
  issuer: 'https://login.mail.example.com/common',
  scope: 'mail.readwrite',
};

function added(
  credential: RecordedCredential,
  placeholders: Readonly<Record<string, string>> | null,
  baseUrl: string,
  provider: string | null = 'mail',
): ConnectionAdded {
  const acting: Pick<ConnectionAdded['data'], 'account_type'> =
    credential.kind === 'authorization' ? { account_type: 'personal' } : {};
  return {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'mail',
      server_type: 'openapi',
      provider,
      placeholders,
      entry: { document: 'https://mail.example.com/openapi.json', base_url: baseUrl },
      credential,
      ...acting,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  };
}

const linked: RecordedConnectionEvent = {
  type: 'connection_link_issued',
  data: { ...ofTheConnection, token_sha256: 'a1b2' },
  context: acted,
};

const ofTheApp = [added(asTheApp, values, atTheMailbox), linked];

const signedIn = [added(signingIn, {}, 'https://api.mail.example.com/v1/self'), linked];

function registryAfter(facts: readonly RecordedConnectionEvent[]) {
  const decider = registryDeciderOf(providers);
  return facts.reduce((state, fact) => decider.evolve(state, fact), decider.initialState);
}

function connectionAfter(facts: readonly RecordedConnectionEvent[]) {
  return Option.getOrThrow(Option.fromNullishOr(registryAfter(facts).get('connection-1'))).connection;
}

interface Choice {
  readonly credential: RecordedCredential;
  readonly placeholders?: Readonly<Record<string, string>>;
  readonly base_url?: string | null;
  readonly account_type?: 'service' | 'personal';
}

function decided(facts: readonly RecordedConnectionEvent[], choice: Choice) {
  const command = {
    type: 'choose_way',
    ...ofTheConnection,
    token_sha256: 'a1b2',
    bindsPerson: true,
    says: {},
  } as const;
  return Result.getOrThrow(
    registryDeciderOf(providers).decide({ ...command, ...acted, ...choice }, registryAfter(facts)),
  );
}

type ChosenData = Omit<WayChosen['data'], 'connection' | 'says'>;

function chosen(data: ChosenData) {
  return { type: 'connection_way_chosen', data: { ...ofTheConnection, says: {}, ...data } } as const;
}

function recordedChosen(data: ChosenData): WayChosen {
  return { ...chosen(data), context: acted };
}

type Recorded = readonly [string, readonly RecordedConnectionEvent[], Choice, readonly unknown[]];

const recorded: readonly Recorded[] = [
  [
    'another way, with its values and the base_url they resolve to',
    signedIn,
    { credential: asTheApp, placeholders: values, base_url: atTheMailbox },
    [chosen({ credential: asTheApp, placeholders: values, base_url: atTheMailbox })],
  ],
  [
    'the way it has with other values, keeping its account type',
    [added(signingIn, {}, 'https://api.mail.example.com/v1/self'), linked],
    { credential: signingIn, placeholders: {}, base_url: 'https://api.mail.example.com/v1/elsewhere' },
    [
      chosen({
        credential: signingIn,
        account_type: 'personal',
        placeholders: {},
        base_url: 'https://api.mail.example.com/v1/elsewhere',
      }),
    ],
  ],
  [
    'the way it has with another mailbox',
    ofTheApp,
    { credential: asTheApp, placeholders: { ...values, mailbox: 'desk@acme.example.com' }, base_url: atTheMailbox },
    [
      chosen({
        credential: asTheApp,
        placeholders: { ...values, mailbox: 'desk@acme.example.com' },
        base_url: atTheMailbox,
      }),
    ],
  ],
  [
    'nothing for the way it has with the same values',
    ofTheApp,
    { credential: asTheApp, placeholders: values, base_url: atTheMailbox },
    [],
  ],
  ['nothing for the way it has, given no values', ofTheApp, { credential: asTheApp }, []],
  [
    'nothing for the way a server given by hand has, which holds no values',
    [added(asTheApp, null, atTheMailbox, null), linked],
    { credential: asTheApp, placeholders: {} },
    [],
  ],
];

describe('choosing a way with the values it asks for', () => {
  it.each(recorded)('records %s', (_case, facts, choice, outcome) => {
    expect(decided(facts, choice)).toEqual(outcome);
  });
});

describe('a connection whose way was chosen with its values, as the stream folds it', () => {
  it('holds the values and the base_url the fact resolved, and no base_url where it resolved none', () => {
    const toTheApp = recordedChosen({ credential: asTheApp, placeholders: values, base_url: atTheMailbox });
    const backToSigningIn = recordedChosen({ credential: signingIn, placeholders: {}, base_url: null });

    expect(connectionAfter([...signedIn, toTheApp])).toMatchObject({
      placeholders: values,
      entry: { base_url: atTheMailbox },
      credential: asTheApp,
    });
    expect(connectionAfter([...ofTheApp, backToSigningIn])).toMatchObject({ placeholders: {}, credential: signingIn });
    expect(connectionAfter([...ofTheApp, backToSigningIn]).entry).not.toHaveProperty('base_url');
  });

  it('keeps its values and base_url where an earlier fact, which carries neither, chose its way', () => {
    const earlier = recordedChosen({ credential: asTheApp });

    expect(connectionAfter([...ofTheApp, earlier])).toMatchObject({
      placeholders: values,
      entry: { document: 'https://mail.example.com/openapi.json', base_url: atTheMailbox },
    });
  });
});

const decodedFact = Schema.decodeUnknownResult(ConnectionEventSchema);

function chosenWith(credential: Readonly<Record<string, unknown>>): unknown {
  return { type: 'connection_way_chosen', data: { ...ofTheConnection, credential, says: {} }, context: acted };
}

describe('the credential of a way that signs an assertion, as a fact records it', () => {
  it('holds its issuer, and the account the token is asked for where its way names one, as earlier releases recorded it, and nothing another kind takes', () => {
    const signing = { kind: 'jwt_bearer', permissions: 'application', issuer: 'https://login.mail.example.com' };
    const outcomes = [
      { ...signing, subject: 'inbox@acme.example.com', scope: 'mail.read' },
      { ...signing, scope: 'mail.read' },
      { kind: 'jwt_bearer', subject: 'inbox@acme.example.com' },
      { ...signing, clients: ['registered'] },
      { ...signing, subject: '' },
    ].map((credential: Readonly<Record<string, unknown>>) => Result.isSuccess(decodedFact(chosenWith(credential))));

    expect(outcomes).toEqual([true, true, false, false, false]);
  });
});
