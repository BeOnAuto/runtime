import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  acted,
  added,
  connected,
  keptAfter,
  key,
  linkOf,
  ofTheConnection,
  registryAfter,
  said,
  signingIn,
} from '../testing/way-choices.ts';
import type { ConnectionCommand } from './connection-commands.ts';
import type { RecordedConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const noProviders = providerListOf();

const decider = registryDeciderOf(noProviders);

const recorded = recordingOf(decider.eventSchema);

function decidedAfter(facts: readonly RecordedConnectionEvent[], command: ConnectionCommand) {
  const decision = Result.getOrThrow(decider.decide(command, registryAfter(noProviders, facts)));
  return {
    types: decision.map(({ type }) => type),
    facts: [...facts, ...decision.map((fact) => recorded(fact, acted))],
  };
}

const forSupportAlone: RecordedConnectionEvent = {
  type: 'connection_playbooks_set',
  data: { ...ofTheConnection, playbooks: ['support'] },
  context: acted,
};

const signingInChosenNext: RecordedConnectionEvent = {
  type: 'connection_next_way_chosen',
  data: { ...ofTheConnection, credential: signingIn, says: said },
  context: acted,
};

const startingForEveryPlaybook = {
  type: 'start',
  ...ofTheConnection,
  token_sha256: 'c3d4',
  state_sha256: 'e5f6',
  verifier_secret_id: 'secret-4',
  client_id: 'auto-runtime',
  client_source: 'dynamic',
  expires_at: '2026-10-15T14:10:00.000Z',
  scope: undefined,
  says: {},
  playbooks: null,
  ...acted,
} as const;

const finishingTheSignIn = {
  type: 'finish',
  ...ofTheConnection,
  token_sha256: 'c3d4',
  state_sha256: 'e5f6',
  secret_id: 'secret-7',
  client_id: 'auto-runtime',
  client_source: 'dynamic',
  connected_by: { id: 'person:grace', name: 'Grace Hopper' },
  ...acted,
} as const;

const theEntry = { url: 'https://acme.tracker.example.com/mcp' };

describe('the playbooks that may use a connection, given to the start of a sign-in', () => {
  it('stay as they are while another way chosen signs in, and are set in the decision that connects it', () => {
    const keyedWithASignInNext = [
      added(null, key, [key, signingIn]),
      linkOf('a1b2'),
      ...connected,
      forSupportAlone,
      signingInChosenNext,
    ];

    const started = decidedAfter(keyedWithASignInNext, startingForEveryPlaybook);
    const finished = decidedAfter(started.facts, finishingTheSignIn);
    const { connection } = keptAfter(noProviders, finished.facts);

    expect([started.types, keptAfter(noProviders, started.facts).connection.entry]).toEqual([
      ['connection_consent_started'],
      { ...theEntry, playbooks: ['support'] },
    ]);
    expect(finished.types).toEqual([
      'connection_way_chosen',
      'connection_playbooks_set',
      'connection_approved',
      'connection_connected',
    ]);
    expect([connection.credential.kind, connection.status, connection.entry]).toEqual([
      'authorization',
      'connected',
      theEntry,
    ]);
  });

  it('are set with the start of a connection signed in again the way it has, as before', () => {
    const signedInBefore = [added(null, signingIn), linkOf('a1b2'), ...connected, forSupportAlone];

    const started = decidedAfter(signedInBefore, startingForEveryPlaybook);

    expect([started.types, keptAfter(noProviders, started.facts).connection.entry]).toEqual([
      ['connection_playbooks_set', 'connection_consent_started'],
      theEntry,
    ]);
  });
});
