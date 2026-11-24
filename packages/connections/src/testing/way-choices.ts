import type { AccountType, ProviderList } from '@on.auto/providers';
import { providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Option, Result } from 'effect';

import type { RecordedCredential } from '../registry/acting-fields.ts';
import type { ConnectionAdded, RecordedConnectionEvent } from '../registry/connection-events.ts';
import { registryDeciderOf } from '../registry/registry-decider.ts';

export const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

export const ofTheConnection = { connection: 'connection-1' };

export const key: RecordedCredential = {
  kind: 'secret',
  permissions: 'delegated',
  name: 'Authorization',
  in: 'header',
};

export const appKey: RecordedCredential = { ...key, permissions: 'application' };

const issuer = 'https://auth.tracker.example.com';

export const signingIn: RecordedCredential = {
  kind: 'authorization',
  permissions: 'delegated',
  issuer,
  clients: ['dynamic'],
};

export const asTheApp: RecordedCredential = { kind: 'client_credentials', permissions: 'application', issuer };

export function added(
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

export function linkOf(token: string): RecordedConnectionEvent {
  return {
    type: 'connection_link_issued',
    data: { ...ofTheConnection, token_sha256: token },
    context: acted,
  };
}

export const connected: readonly RecordedConnectionEvent[] = [
  { type: 'connection_approved', data: ofTheConnection, context: acted },
  {
    type: 'connection_connected',
    data: { ...ofTheConnection, secret_id: 'secret-1', connected_by: { id: 'person:ada', name: 'Ada' } },
    context: acted,
  },
  linkOf('c3d4'),
];

export const [aKey] = tracker.credentials;

const [, noCredential] = tracker.credentials;

export function trackerWith(...ways: readonly unknown[]): ProviderList {
  return providerListOf(providerOf({ ...tracker, credentials: ways }));
}

export const bothTypes = trackerWith(aKey, { ...aKey, permissions: 'application' }, noCredential);

export const said = { read: 'Read the issues.' };

export interface Choice {
  readonly credential: RecordedCredential;
  readonly account_type?: AccountType;
  readonly placeholders?: Readonly<Record<string, string>>;
  readonly token_sha256?: string;
  readonly by?: string;
}

export function registryAfter(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  const decider = registryDeciderOf(providers);
  return facts.reduce((state, fact) => decider.evolve(state, fact), decider.initialState);
}

export function decided(providers: ProviderList, facts: readonly RecordedConnectionEvent[], choice: Choice) {
  const command = {
    type: 'choose_way',
    ...ofTheConnection,
    token_sha256: 'a1b2',
    says: said,
  } as const;
  const decision = registryDeciderOf(providers).decide(
    { ...command, ...acted, ...choice },
    registryAfter(providers, facts),
  );
  return Result.isSuccess(decision) ? decision.success : decision.failure;
}

export function keptAfter(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  return Option.getOrThrow(Option.fromNullishOr(registryAfter(providers, facts).get('connection-1')));
}

export const started = {
  ...ofTheConnection,
  state_sha256: 'd4e5',
  verifier_secret_id: 'secret-3',
  client_id: 'org-app',
  client_source: 'own',
  expires_at: '2026-10-15T14:10:00.000Z',
  says: {},
} as const;

export const signingInUnderItsOwnClient: readonly RecordedConnectionEvent[] = [
  added('tracker', { ...signingIn, client_source: 'own' }),
  linkOf('a1b2'),
  {
    type: 'connection_client_given',
    data: { ...ofTheConnection, client_id: 'org-app', secret_id: 's-2' },
    context: acted,
  },
  { type: 'connection_consent_started', data: started, context: acted },
];
