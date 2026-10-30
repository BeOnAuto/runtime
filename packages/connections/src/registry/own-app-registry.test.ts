import { recordingOf } from '@on.auto/operations';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDecider } from './registry-decider.ts';
import { clientSecretsReleasedOf, signingInClientOf, type KeptConnection } from './registry.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:05:00.000Z' };

const posts: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: '0199-posts',
    name: 'posts',
    server_type: 'mcp',
    provider: 'posts',
    placeholders: {},
    entry: { url: 'https://mcp.posts.example.com/mcp' },
    credential: { kind: 'authorization', issuer: 'https://auth.posts.example.com', client_source: 'own' },
    says: {},
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
};

function clientGiven(clientId: string, secretId: string): ConnectionEvent {
  return {
    type: 'connection_client_given',
    data: { connection: '0199-posts', client_id: clientId, secret_id: secretId },
  };
}

function connectedUnder(clientId: string, secretId: string): ConnectionEvent {
  return {
    type: 'connection_connected',
    data: {
      connection: '0199-posts',
      secret_id: secretId,
      client_id: clientId,
      client_source: 'own',
      connected_by: { id: 'person:grace', name: 'Grace Hopper' },
    },
  };
}

function postsAfter(...events: readonly ConnectionEvent[]): KeptConnection {
  const registry = events.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return Option.getOrThrow(Option.fromNullishOr(registry.get('0199-posts')));
}

function heldAfter(...events: readonly ConnectionEvent[]) {
  const { connection, clientSecretId, nextClient } = postsAfter(...events);
  return { client_id: connection.credential.client_id, clientSecretId, nextClient };
}

const connected = [posts, clientGiven('org-app', 'secret-1'), connectedUnder('org-app', 'secret-2')];

describe('a connection under the org’s own app that holds no tokens, as the stream folds it', () => {
  it('runs under the client given on the page at once, a later client replacing it with its secret', () => {
    expect([
      heldAfter(posts),
      heldAfter(posts, clientGiven('org-app', 'secret-1')),
      heldAfter(posts, clientGiven('org-app', 'secret-1'), clientGiven('another-app', 'secret-2')),
    ]).toEqual([
      { client_id: undefined, clientSecretId: undefined, nextClient: undefined },
      { client_id: 'org-app', clientSecretId: 'secret-1', nextClient: undefined },
      { client_id: 'another-app', clientSecretId: 'secret-2', nextClient: undefined },
    ]);
  });
});

describe('a connection under the org’s own app that holds tokens, as the stream folds it', () => {
  it('keeps another client id as its next client, and runs under it once a sign-in under it connects', () => {
    const next = clientGiven('renewed-app', 'secret-3');

    expect([
      heldAfter(...connected),
      heldAfter(...connected, next),
      heldAfter(...connected, next, connectedUnder('renewed-app', 'secret-4')),
    ]).toEqual([
      { client_id: 'org-app', clientSecretId: 'secret-1', nextClient: undefined },
      {
        client_id: 'org-app',
        clientSecretId: 'secret-1',
        nextClient: { client_id: 'renewed-app', secret_id: 'secret-3' },
      },
      { client_id: 'renewed-app', clientSecretId: 'secret-3', nextClient: undefined },
    ]);
    expect(postsAfter(...connected, next).secretId).toBe('secret-2');
  });

  it('replaces the secret of the client it runs under at once, and drops a next client given before', () => {
    const rotated = clientGiven('org-app', 'secret-4');

    expect([
      heldAfter(...connected, rotated),
      heldAfter(...connected, clientGiven('renewed-app', 'secret-3'), rotated),
    ]).toEqual([
      { client_id: 'org-app', clientSecretId: 'secret-4', nextClient: undefined },
      { client_id: 'org-app', clientSecretId: 'secret-4', nextClient: undefined },
    ]);
  });

  it('keeps its next client through a connection under the client it runs under', () => {
    expect(
      heldAfter(...connected, clientGiven('renewed-app', 'secret-3'), connectedUnder('org-app', 'secret-4')),
    ).toEqual({
      client_id: 'org-app',
      clientSecretId: 'secret-1',
      nextClient: { client_id: 'renewed-app', secret_id: 'secret-3' },
    });
  });
});

describe('the clients of a connection under the org’s own app', () => {
  it('sign in under the next client where there is one, and otherwise under the client it runs under', () => {
    expect([
      signingInClientOf(postsAfter(posts)),
      signingInClientOf(postsAfter(...connected)),
      signingInClientOf(postsAfter(...connected, clientGiven('renewed-app', 'secret-3'))),
    ]).toEqual([
      undefined,
      { client_id: 'org-app', secret_id: 'secret-1' },
      { client_id: 'renewed-app', secret_id: 'secret-3' },
    ]);
  });

  it('let go of the secrets a fact replaced, and of no other', () => {
    const before = postsAfter(...connected, clientGiven('renewed-app', 'secret-3'));
    const rotated = postsAfter(
      ...connected,
      clientGiven('renewed-app', 'secret-3'),
      clientGiven('org-app', 'secret-4'),
    );
    const promoted = postsAfter(
      ...connected,
      clientGiven('renewed-app', 'secret-3'),
      connectedUnder('renewed-app', 'secret-5'),
    );

    expect([
      clientSecretsReleasedOf(before, rotated),
      clientSecretsReleasedOf(before, promoted),
      clientSecretsReleasedOf(before, before),
    ]).toEqual([['secret-1', 'secret-3'], ['secret-1'], []]);
  });
});

const acting = { token_sha256: 'a1b2', bindsPerson: true, ...acted };

const linkIssued: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: '0199-posts', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
};

const startedUnderTheOrgsApp: ConnectionEvent = {
  type: 'connection_consent_started',
  data: {
    connection: '0199-posts',
    state_sha256: 'c3d4',
    verifier_secret_id: 'secret-2',
    client_id: 'org-app',
    client_source: 'own',
    expires_at: '2026-10-15T14:15:00.000Z',
    says: {},
  },
};

const starting: ConnectionCommand = {
  type: 'start',
  connection: '0199-posts',
  ...acting,
  state_sha256: 'c3d4',
  verifier_secret_id: 'secret-2',
  client_id: 'org-app',
  client_source: 'own',
  expires_at: '2026-10-15T14:15:00.000Z',
  scope: undefined,
  says: {},
};

const finishing: ConnectionCommand = {
  type: 'finish',
  connection: '0199-posts',
  ...acting,
  connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
  state_sha256: 'c3d4',
  secret_id: 'secret-3',
  client_id: 'org-app',
  client_source: 'own',
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

const givenAgain =
  "The client of the org's own app for the connection posts was given again meanwhile, so the person signs in again under the client given last";

describe('the start and the finish of a consent under the org’s own app, as the decider takes them', () => {
  it('are refused where they took a client the next sign-in no longer takes, as a client given meanwhile leaves it', () => {
    const given = [posts, linkIssued, clientGiven('org-app', 'secret-1')];
    const givenMeanwhile = clientGiven('another-app', 'secret-4');

    expect([
      decided(starting, ...given),
      decided(starting, ...given, givenMeanwhile),
      decided(finishing, ...given, startedUnderTheOrgsApp),
      decided(finishing, ...given, startedUnderTheOrgsApp, givenMeanwhile),
    ]).toMatchObject([
      Result.succeed([{ type: 'connection_consent_started' }]),
      Result.fail({ _tag: 'conflict', detail: givenAgain }),
      Result.succeed([{ type: 'connection_approved' }, { type: 'connection_connected' }]),
      Result.fail({ _tag: 'conflict', detail: givenAgain }),
    ]);
  });
});
