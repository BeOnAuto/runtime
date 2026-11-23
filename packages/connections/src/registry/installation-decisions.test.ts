import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const registryDecider = registryDeciderOf(providerListOf());

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const driveAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: 'drive-id',
    name: 'drive',
    server_type: 'mcp',
    provider: 'drive',
    placeholders: {},
    entry: { url: 'https://mcp.drive.example.com/mcp' },
    credential: { kind: 'authorization', issuer: 'https://accounts.drive.example.com' },
    says: {},
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
};

const linkIssued: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'drive-id', token_sha256: 'a1b2' },
};

const started: ConnectionEvent = {
  type: 'connection_consent_started',
  data: {
    connection: 'drive-id',
    state_sha256: 'c3d4',
    verifier_secret_id: 'secret-1',
    client_id: 'auto-runtime',
    client_source: 'registered',
    expires_at: '2026-10-15T14:10:00.000Z',
    says: {},
  },
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

const listed = { chosen: '41', listed: [{ id: '41', name: 'acme', admin: true }] };

const finishingWithoutASecret: ConnectionCommand = {
  type: 'finish',
  connection: 'drive-id',
  token_sha256: 'a1b2',
  connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
  state_sha256: 'c3d4',
  client_id: 'auto-runtime',
  client_source: 'registered',
  ...acted,
};

const installs: ConnectionEvent = {
  ...driveAdded,
  data: {
    ...driveAdded.data,
    credential: {
      kind: 'authorization',
      permissions: 'application',
      issuer: 'https://accounts.drive.example.com',
      installation: {
        issuer: 'https://api.drive.example.com',
        installations: {
          method: 'GET',
          url: 'https://api.drive.example.com/user/installations',
          list: '/installations',
          id: '/id',
          name: '/account/name',
          account: '/account/id',
          personal: { '/account/kind': ['person'] },
        },
        userinfo: { method: 'GET', url: 'https://api.drive.example.com/me', id: '/id' },
        membership: {
          method: 'GET',
          url: 'https://api.drive.example.com/memberships/{account_name}',
          admin: { '/role': ['admin'] },
        },
        returned: { installation: 'installation_id' },
        token_request: {
          method: 'POST',
          url: 'https://api.drive.example.com/installations/{installation_id}/tokens',
          issued: { access_token: '/token' },
        },
      },
    },
  },
};

describe('the finish of a consent and the installation it names, as the decider takes it', () => {
  it('is refused where the connection installs nothing and the finish names an installation', () => {
    const naming: ConnectionCommand = { ...finishingWithoutASecret, installation: listed };

    expect(Result.isFailure(decided(naming, driveAdded, linkIssued, started))).toBe(true);
  });

  it('is refused where the connection installs the application and the finish names no installation', () => {
    expect([
      Result.isFailure(decided(finishingWithoutASecret, installs, linkIssued, started)),
      Result.isSuccess(decided({ ...finishingWithoutASecret, installation: listed }, installs, linkIssued, started)),
    ]).toEqual([true, true]);
  });

  it('takes the installation chosen where the person administers its account, and records it without the mark', () => {
    const facts = Result.getOrThrow(
      decided({ ...finishingWithoutASecret, installation: listed }, installs, linkIssued, started),
    );

    const connected = facts.find(({ type }) => type === 'connection_connected');

    expect(connected).toMatchObject({ data: { installation: { id: '41', name: 'acme' } } });
    expect(connected).not.toHaveProperty('data.installation.admin');
  });

  it('refuses at /installation an installation listed on an account the person does not administer', () => {
    const unadministered = { chosen: '42', listed: [...listed.listed, { id: '42', name: 'acme-labs', admin: false }] };
    const refused = decided(
      { ...finishingWithoutASecret, installation: unadministered },
      installs,
      linkIssued,
      started,
    );

    expect(Result.getOrThrow(Result.flip(refused))).toMatchObject({
      _tag: 'invalid_input',
      issues: [{ pointer: '/installation' }],
    });
  });
});
