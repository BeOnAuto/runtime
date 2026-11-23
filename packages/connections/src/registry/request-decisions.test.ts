import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Option, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionChanges } from './connection-changes.ts';
import type { ConnectionCommand, ConnectionCommandData } from './connection-commands.ts';
import { registryDeciderOf } from './registry-decider.ts';
import type { Registry } from './registry.ts';

const decider = registryDeciderOf(providerListOf());

const recorded = recordingOf(decider.eventSchema);

const editor = { id: 'person:grace', name: 'Grace Hopper' };

const admin = { id: 'person:ada', name: 'Ada Lovelace' };

const askedAt = '2026-11-21T10:00:00.000Z';

const answeredAt = '2026-11-21T11:00:00.000Z';

const addition = {
  connection: 'crm-id',
  name: 'crm',
  server_type: 'mcp',
  provider: null,
  placeholders: null,
  entry: { url: 'https://crm.example.com/mcp' },
  credential: { kind: 'none' },
  says: {},
} as const;

const link = { token_sha256: 'a1b2' };

function byTheEditor(data: ConnectionCommandData): ConnectionCommand {
  return { ...data, by: editor.id, at: askedAt };
}

function byTheAdmin(data: ConnectionCommandData): ConnectionCommand {
  return { ...data, by: admin.id, at: answeredAt };
}

const asked = byTheEditor({ type: 'request', ...addition, added_by: editor, message: 'To send the weekly summary.' });

const askedWithNoWords = byTheEditor({ type: 'request', ...addition, added_by: editor });

const added = byTheAdmin({ type: 'add', ...addition, added_by: admin, link });

const reviewed = byTheAdmin({
  type: 'reconnect',
  connection: 'crm-id',
  link,
  connected_by: admin,
  variablesSet: new Set(),
});

const approved = byTheAdmin({
  type: 'approve',
  connection: 'crm-id',
  token_sha256: link.token_sha256,
  connected_by: admin,
});

const declined = byTheAdmin({ type: 'decline', connection: 'crm-id' });

const removed = byTheAdmin({ type: 'remove', connection: 'crm-id' });

function decidedOn(registry: Registry, command: ConnectionCommand) {
  return decider.decide(command, registry);
}

function after(...commands: readonly ConnectionCommand[]): Registry {
  return commands.reduce(
    (registry, command) =>
      Result.getOrThrow(decidedOn(registry, command)).reduce(
        (state, event) => decider.evolve(state, recorded(event, command)),
        registry,
      ),
    decider.initialState,
  );
}

function standingOf(registry: Registry) {
  const { connection, link: open } = Option.getOrThrow(Option.fromNullishOr(registry.get('crm-id')));
  return { status: connection.status, request: connection.request, linked: open !== undefined };
}

function typesDecided(registry: Registry, command: ConnectionCommand) {
  return Result.map(decidedOn(registry, command), (events) => events.map(({ type }) => type));
}

describe('a request to connect, by someone who may not approve the connection', () => {
  it('records the connection added and the request in one decision, with no link, and keeps the message only where one was given', () => {
    expect([decidedOn(decider.initialState, asked), decidedOn(decider.initialState, askedWithNoWords)]).toEqual([
      Result.succeed([
        expect.objectContaining({ type: 'connection_added' }),
        { type: 'connection_requested', data: { connection: 'crm-id', message: 'To send the weekly summary.' } },
      ]),
      Result.succeed([
        expect.objectContaining({ type: 'connection_added' }),
        { type: 'connection_requested', data: { connection: 'crm-id' } },
      ]),
    ]);
  });

  it('is folded open on the pending connection, who and when from the fact itself, with no link to open', () => {
    expect([standingOf(after(asked)), standingOf(after(askedWithNoWords)).request]).toEqual([
      {
        status: 'pending',
        request: { message: 'To send the weekly summary.', requested_by: editor.id, requested_at: askedAt },
        linked: false,
      },
      { message: null, requested_by: editor.id, requested_at: askedAt },
    ]);
  });

  it('is refused as an addition is, where the org already holds a connection of its name', () => {
    expect(decidedOn(after(added), asked)).toMatchObject(Result.fail({ _tag: 'conflict', kind: 'taken' }));
  });
});

describe('a request answered', () => {
  it.each([
    ['given a link by reconnecting it, which stays open', [reviewed], { status: 'pending', open: true, linked: true }],
    ['connected through that link', [reviewed, approved], { status: 'connected', open: false, linked: false }],
    ['declined', [declined], { status: 'removed', open: false, linked: false }],
    ['removed', [removed], { status: 'removed', open: false, linked: false }],
  ] as const)('%s', (_case, answers, standing) => {
    const { status, request, linked } = standingOf(after(asked, ...answers));

    expect({ status, open: request !== null, linked }).toEqual(standing);
  });

  it('is declined by recording the decline and the removal of the connection, in that order', () => {
    expect(typesDecided(after(asked), declined)).toEqual(
      Result.succeed(['connection_request_declined', 'connection_removed']),
    );
  });

  it('is given its link by the reconnection a pending connection takes', () => {
    expect(typesDecided(after(asked), reviewed)).toEqual(Result.succeed(['connection_link_issued']));
  });
});

describe('declining what is not an open request', () => {
  it.each([
    ['a connection added with its link', [added]],
    ['a request connected', [asked, reviewed, approved]],
    ['a request declined already', [asked, declined]],
    ['a request removed', [asked, removed]],
  ] as const)('is refused for %s, recording nothing', (_case, history) => {
    expect(decidedOn(after(...history), declined)).toMatchObject(Result.fail({ _tag: 'conflict' }));
  });

  it('is refused as not found for a connection the org does not hold', () => {
    expect(decidedOn(decider.initialState, declined)).toMatchObject(Result.fail({ _tag: 'not_found' }));
  });
});

describe('the facts of a request, read by the fold and by the changes Studio follows', () => {
  it('fold over a connection the org does not hold as nothing, never throwing', () => {
    const declinedOfNone = recorded({ type: 'connection_request_declined', data: { connection: 'gone' } }, declined);

    expect(decider.evolve(decider.initialState, declinedOfNone)).toBe(decider.initialState);
  });

  it('name no change of their own, since the addition and the removal beside them name the connection', () => {
    expect([
      connectionChanges.changes.named['connection_requested'],
      connectionChanges.changes.named['connection_request_declined'],
    ]).toEqual([null, null]);
  });
});
