import { recordingOf, type ActedContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import type { ConnectionEvent } from './connection-events.ts';
import { registryDecider } from './registry-decider.ts';
import { newestFirst, type Registry } from './registry.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const added: ActedContext = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const later: ActedContext = { by: 'person:grace', at: '2026-10-15T14:05:00.000Z' };

const crm = {
  connection: '0199-crm',
  name: 'crm',
  server_type: 'mcp',
  provider: null,
  placeholders: null,
  entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
  added_by: { id: 'person:ada', name: 'Ada Lovelace' },
} as const;

const crmAdded: ConnectionEvent = { type: 'connection_added', data: crm };

const history: readonly ConnectionEvent[] = [
  crmAdded,
  {
    type: 'connection_link_issued',
    data: { connection: '0199-crm', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
  },
];

const approval: ConnectionEvent = { type: 'connection_approved', data: { connection: '0199-crm' } };

const connection: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: '0199-crm', secret_id: 'secret-1', connected_by: { id: 'person:grace', name: 'Grace Hopper' } },
};

function evolvedWith(registry: Registry, event: ConnectionEvent, context: ActedContext): Registry {
  return registryDecider.evolve(registry, recorded(event, context));
}

function crmAfter(...events: readonly ConnectionEvent[]) {
  const registry = history.reduce((state, event) => evolvedWith(state, event, added), registryDecider.initialState);
  return events.reduce((state, event) => evolvedWith(state, event, later), registry).get('0199-crm');
}

describe('an added connection, as the stream folds it', () => {
  it('is pending, added by the caller its fact names, by id and name, with its link open', () => {
    expect(crmAfter()).toEqual({
      connection: {
        id: '0199-crm',
        name: 'crm',
        type: 'mcp',
        provider: null,
        placeholders: null,
        entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
        credential: { kind: 'secret', name: 'Authorization', in: 'header' },
        status: 'pending',
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
        added_at: '2026-10-15T14:00:00.000Z',
        connected_at: null,
        connected_by: null,
        granted_scope: null,
        broken: null,
      },
      link: { token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
      replacedLinks: new Set(),
      secretId: undefined,
      algorithm: undefined,
    });
  });

  it('takes an approval, then a connection with its secret, which closes the link', () => {
    expect(crmAfter(approval)).toMatchObject({ connection: { status: 'pending' }, link: { token_sha256: 'a1b2' } });
    expect(crmAfter(approval, connection)).toMatchObject({
      connection: {
        status: 'connected',
        connected_at: '2026-10-15T14:05:00.000Z',
        connected_by: { id: 'person:grace', name: 'Grace Hopper' },
        broken: null,
      },
      link: undefined,
      secretId: 'secret-1',
    });
  });
});

describe('a later link of a connection, as the stream folds it', () => {
  it('takes the place of the one before, keeping the digest of one it replaced and none of one used up', () => {
    const nextLink: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: '0199-crm', token_sha256: 'c3d4', expires_at: '2026-10-16T14:05:00.000Z' },
    };

    expect(crmAfter(nextLink)).toMatchObject({
      link: { token_sha256: 'c3d4', expires_at: '2026-10-16T14:05:00.000Z' },
      replacedLinks: new Set(['a1b2']),
    });
    expect(crmAfter(approval, connection, nextLink)?.replacedLinks).toEqual(new Set());
  });
});

describe('a connected connection, as the stream folds it', () => {
  it('takes a break with its sentence, and a removal, which keeps the id of the secret to forget', () => {
    const breaking: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: '0199-crm', reason: 'Its credential cannot be read' },
    };
    const removal: ConnectionEvent = { type: 'connection_removed', data: { connection: '0199-crm' } };

    expect(crmAfter(connection, breaking)).toMatchObject({
      connection: { status: 'broken', broken: 'Its credential cannot be read' },
    });
    expect(crmAfter(connection, removal)).toMatchObject({
      connection: { status: 'removed', broken: null },
      secretId: 'secret-1',
    });
  });
});

describe('the registry of connections', () => {
  it('leaves out a fact of a connection it never added, and lists the connections newest first', () => {
    const wiki: ConnectionEvent = { type: 'connection_added', data: { ...crm, connection: '0199-wiki', name: 'wiki' } };
    const stray: ConnectionEvent = { type: 'connection_removed', data: { connection: 'nowhere' } };
    const registry = [crmAdded, wiki, stray].reduce(
      (state, event) => evolvedWith(state, event, later),
      registryDecider.initialState,
    );

    expect(newestFirst(registry).map((kept) => kept.connection.name)).toEqual(['wiki', 'crm']);
    expect(registry.has('nowhere')).toBe(false);
  });
});

const issuer = 'https://auth.billing.example.com';

function credentialAfter(...events: readonly ConnectionEvent[]) {
  const registry = events.reduce((state, event) => evolvedWith(state, event, later), registryDecider.initialState);
  return registry.get('0199-billing')?.connection.credential;
}

describe('a connection of client credentials whose client id is given on the page, as the stream folds it', () => {
  it('holds no client id while it is pending, and the one its connection names once it is connected', () => {
    const billing: ConnectionEvent = {
      type: 'connection_added',
      data: {
        connection: '0199-billing',
        name: 'billing',
        server_type: 'openapi',
        provider: null,
        placeholders: null,
        entry: { document: 'https://billing.example.com/openapi.json' },
        credential: { kind: 'client_credentials', issuer },
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
      },
    };
    const connectedWithItsClient: ConnectionEvent = {
      type: 'connection_connected',
      data: {
        connection: '0199-billing',
        secret_id: 'secret-2',
        client_id: 'acme',
        connected_by: { id: 'person:grace', name: 'Grace Hopper' },
      },
    };

    expect([credentialAfter(billing), credentialAfter(billing, connectedWithItsClient)]).toEqual([
      { kind: 'client_credentials', issuer },
      { kind: 'client_credentials', issuer, client_id: 'acme' },
    ]);
  });
});
