import { recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand, PlaybooksChoice } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import type { Credential } from './credential.ts';
import { registryDecider } from './registry-decider.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ada = { id: 'person:ada', name: 'Ada Lovelace' };

function addedWith(credential: Credential): ConnectionEvent {
  return {
    type: 'connection_added',
    data: {
      connection: 'crm-id',
      name: 'crm',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://crm.example.com/mcp', playbooks: ['sales'] },
      credential,
      says: {},
      added_by: ada,
    },
  };
}

const linkIssued: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'crm-id', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
};

const linkUse = { connection: 'crm-id', token_sha256: 'a1b2', bindsPerson: true };

function decided(command: ConnectionCommand, credential: Credential) {
  const registry = [addedWith(credential), linkIssued].reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

interface Acting {
  readonly by?: string;
  readonly token_sha256?: string;
}

function approving(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return { type: 'approve', ...linkUse, connected_by: ada, ...choice, ...acted, ...acting };
}

function giving(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return { type: 'give', ...linkUse, connected_by: ada, secret_id: 'secret-1', ...choice, ...acted, ...acting };
}

function starting(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return {
    type: 'start',
    ...linkUse,
    state_sha256: 'c3d4',
    verifier_secret_id: 'secret-2',
    client_id: 'auto-runtime',
    client_source: 'registered',
    expires_at: '2026-10-15T14:10:00.000Z',
    scope: undefined,
    says: {},
    ...choice,
    ...acted,
    ...acting,
  };
}

const takingNone: Credential = { kind: 'none' };

const takingASecret: Credential = { kind: 'secret', name: 'Authorization', in: 'header' };

const byConsent: Credential = { kind: 'authorization', issuer: 'https://auth.crm.example.com', clients: ['dynamic'] };

function setTo(playbooks: readonly string[] | null): ConnectionEvent {
  return { type: 'connection_playbooks_set', data: { connection: 'crm-id', playbooks } };
}

const approved: ConnectionEvent = { type: 'connection_approved', data: { connection: 'crm-id' } };

const connected: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', connected_by: ada },
};

const connectedWithItsSecret: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', secret_id: 'secret-1', connected_by: ada },
};

describe('an approval that names the playbooks that may use the connection', () => {
  it('records them before the approval, in the same decision, where they differ from those its entry names', () => {
    expect([
      decided(approving({ playbooks: ['support'] }), takingNone),
      decided(approving({ playbooks: null }), takingNone),
      decided(approving({ playbooks: ['sales'] }), takingNone),
      decided(approving({}), takingNone),
    ]).toEqual([
      Result.succeed([setTo(['support']), approved, connected]),
      Result.succeed([setTo(null), approved, connected]),
      Result.succeed([approved, connected]),
      Result.succeed([approved, connected]),
    ]);
  });

  it('is taken by a credential given and a consent started alike', () => {
    expect([
      decided(giving({ playbooks: ['support'] }), takingASecret),
      decided(giving({ playbooks: ['sales'] }), takingASecret),
      Result.map(decided(starting({ playbooks: ['support'] }), byConsent), (events) => events.map(({ type }) => type)),
      Result.map(decided(starting({ playbooks: ['sales'] }), byConsent), (events) => events.map(({ type }) => type)),
    ]).toEqual([
      Result.succeed([setTo(['support']), approved, connectedWithItsSecret]),
      Result.succeed([approved, connectedWithItsSecret]),
      Result.succeed(['connection_playbooks_set', 'connection_consent_started']),
      Result.succeed(['connection_consent_started']),
    ]);
  });
});

describe('an approval refused that names playbooks', () => {
  it('records nothing, whether another person approves or the token is not the link’s', () => {
    expect([
      decided(approving({ playbooks: ['support'] }, { by: 'person:grace' }), takingNone),
      decided(giving({ playbooks: ['support'] }, { token_sha256: 'e5f6' }), takingASecret),
      decided(starting({ playbooks: ['support'] }, { by: 'person:grace' }), byConsent),
    ]).toMatchObject([
      Result.fail({ _tag: 'forbidden' }),
      Result.fail({ _tag: 'not_found' }),
      Result.fail({ _tag: 'forbidden' }),
    ]);
  });
});
