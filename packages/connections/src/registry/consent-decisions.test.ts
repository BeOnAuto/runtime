import { recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDecider } from './registry-decider.ts';

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
  data: { connection: 'drive-id', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

const byConsent =
  'The connection drive is connected by signing in to its provider and allowing Auto, which its page starts';

describe('a credential given to a connection of consent', () => {
  it('is refused, though the link is open', () => {
    const giving: ConnectionCommand = {
      type: 'give',
      connection: 'drive-id',
      token_sha256: 'a1b2',
      bindsPerson: true,
      connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
      secret_id: 'secret-1',
      ...acted,
    };

    expect(decided(giving, driveAdded, linkIssued)).toMatchObject(Result.fail({ detail: byConsent }));
  });
});

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

const finishingDrive: ConnectionCommand = {
  type: 'finish',
  connection: 'drive-id',
  token_sha256: 'a1b2',
  bindsPerson: true,
  connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
  state_sha256: 'c3d4',
  secret_id: 'secret-2',
  client_id: 'auto-runtime',
  client_source: 'registered',
  ...acted,
};

describe('the finish of a consent, as the decider takes it', () => {
  it('records the approval and the connection with its client, and the scope where one was granted', () => {
    expect(decided({ ...finishingDrive, scope: 'files.read' }, driveAdded, linkIssued, started)).toEqual(
      Result.succeed([
        { type: 'connection_approved', data: { connection: 'drive-id' } },
        {
          type: 'connection_connected',
          data: {
            connection: 'drive-id',
            secret_id: 'secret-2',
            client_id: 'auto-runtime',
            client_source: 'registered',
            scope: 'files.read',
            connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
          },
        },
      ]),
    );
  });

  it('is refused with no open start, one past its ten minutes, a state not its own, or a connection of another kind', () => {
    const late = { ...finishingDrive, at: '2026-10-15T14:11:00.000Z' };
    const secretAdded: ConnectionEvent = {
      ...driveAdded,
      data: { ...driveAdded.data, credential: { kind: 'secret', in: 'header', name: 'Authorization' } },
    };

    expect([
      decided(finishingDrive, driveAdded, linkIssued),
      decided(late, driveAdded, linkIssued, started),
      decided({ ...finishingDrive, state_sha256: 'e5f6' }, driveAdded, linkIssued, started),
      decided(finishingDrive, secretAdded, linkIssued),
    ]).toMatchObject([
      Result.fail({ _tag: 'not_found' }),
      Result.fail({ _tag: 'not_found' }),
      Result.fail({ _tag: 'invalid_input', issues: [{ pointer: '/state' }] }),
      Result.fail({ _tag: 'conflict' }),
    ]);
  });
});

function fold(...events: readonly ConnectionEvent[]) {
  return events
    .reduce((state, event) => registryDecider.evolve(state, recorded(event, acted)), registryDecider.initialState)
    .get('drive-id');
}

describe('the fold of a consent', () => {
  it('keeps the open start while the connection is pending, drops it once connected, and keeps it at removal', () => {
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'drive-id' } };
    const connectedDrive: ConnectionEvent = {
      type: 'connection_connected',
      data: {
        connection: 'drive-id',
        secret_id: 'secret-2',
        client_id: 'auto-runtime',
        client_source: 'registered',
        connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
      },
    };
    expect([
      fold(driveAdded, linkIssued, started)?.consent,
      fold(driveAdded, linkIssued, started, connectedDrive)?.consent,
      fold(driveAdded, linkIssued, started, removed)?.consent?.verifier_secret_id,
    ]).toEqual([
      {
        state_sha256: 'c3d4',
        verifier_secret_id: 'secret-1',
        client_id: 'auto-runtime',
        client_source: 'registered',
        started_at: '2026-10-15T14:00:00.000Z',
        expires_at: '2026-10-15T14:10:00.000Z',
      },
      undefined,
      'secret-1',
    ]);
    expect(fold(driveAdded, linkIssued, started, connectedDrive)?.connection.credential).toEqual({
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      client_id: 'auto-runtime',
      client_source: 'registered',
    });
  });
});

const askingToReadAndWrite: ConnectionEvent = {
  ...driveAdded,
  data: {
    ...driveAdded.data,
    credential: {
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      scope: 'files.read files.write',
    },
  },
};

const grantedTheRead: ConnectionEvent = {
  type: 'connection_connected',
  data: {
    connection: 'drive-id',
    secret_id: 'secret-2',
    client_id: 'auto-runtime',
    client_source: 'registered',
    scope: 'files.read',
    connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
};

function scopesOf(...events: readonly ConnectionEvent[]) {
  const connection = fold(...events)?.connection;
  return { asked: connection?.credential.scope, granted: connection?.granted_scope };
}

describe('the scopes of a connection of consent, as the stream folds them', () => {
  it('keep the scope its way asked in the credential and the scope the server granted beside it, so a narrower grant shows', () => {
    expect([
      scopesOf(askingToReadAndWrite, linkIssued, started),
      scopesOf(askingToReadAndWrite, linkIssued, started, grantedTheRead),
    ]).toEqual([
      { asked: 'files.read files.write', granted: null },
      { asked: 'files.read files.write', granted: 'files.read' },
    ]);
  });
});

const readWords = 'Read the files of the account.';

const shareWords = 'Share the files of the account with other people.';

const addedWithWords: ConnectionEvent = {
  ...askingToReadAndWrite,
  data: { ...askingToReadAndWrite.data, says: { 'files.read': readWords } },
};

const askingToShare: ConnectionEvent = {
  ...started,
  data: { ...started.data, scope: 'files.read files.share', says: { 'files.share': shareWords } },
};

const grantedTheShare: ConnectionEvent = {
  ...grantedTheRead,
  data: { ...grantedTheRead.data, scope: 'files.read files.share' },
};

describe('the fold of a consent that asks more', () => {
  it('adds to the scopes asked those the consent asks beyond them, with the words it records, and keeps its scope with the open consent', () => {
    const kept = fold(addedWithWords, linkIssued, askingToShare);

    expect([kept?.connection.asked_scopes, kept?.consent?.scope, kept?.connection.credential.scope]).toEqual([
      [
        { name: 'files.read', says: readWords },
        { name: 'files.write', says: null },
        { name: 'files.share', says: shareWords },
      ],
      'files.read files.share',
      'files.read files.write',
    ]);
  });

  it('takes the words of what it was granted from the grown scopes asked once it finishes', () => {
    const connected = fold(addedWithWords, linkIssued, askingToShare, grantedTheShare)?.connection;

    expect([connected?.granted_scope, connected?.granted_scopes]).toEqual([
      'files.read files.share',
      [
        { name: 'files.read', says: readWords },
        { name: 'files.share', says: shareWords },
      ],
    ]);
  });

  it('reads a start that names no scope as one that asks the scope of the credential, and adds nothing to the scopes asked', () => {
    const kept = fold(addedWithWords, linkIssued, started);

    expect([kept?.consent?.scope, kept?.connection.asked_scopes]).toEqual([
      'files.read files.write',
      [
        { name: 'files.read', says: readWords },
        { name: 'files.write', says: null },
      ],
    ]);
  });
});

describe('a link given for a group of more, as the stream folds it', () => {
  it('names the group, and a plain link after it names none', () => {
    const forMore: ConnectionEvent = { ...linkIssued, data: { ...linkIssued.data, more: 'share' } };
    const plain: ConnectionEvent = { ...linkIssued, data: { ...linkIssued.data, token_sha256: 'e5f6' } };

    expect([fold(driveAdded, forMore)?.link, fold(driveAdded, forMore, plain)?.link]).toEqual([
      { token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z', more: 'share' },
      { token_sha256: 'e5f6', expires_at: '2026-10-16T14:00:00.000Z' },
    ]);
  });
});
