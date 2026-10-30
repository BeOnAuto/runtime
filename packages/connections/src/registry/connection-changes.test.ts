import { changeCatalogOf } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { connectionChanges } from '../index.ts';

const context = { at: '2026-10-05T09:00:00.000Z', by: 'ada' };

const catalog = changeCatalogOf([connectionChanges]);

describe('the changes the facts of the connections of an org make', () => {
  it('name a connection broken or removed by its id to a caller who may read the org, and nothing for the steps of its consent', () => {
    expect([
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_broken',
        data: { connection: 'c1', kind: 'credential_refused', reason: 'Its server refused the key' },
        context,
      }),
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_removed',
        data: { connection: 'c2' },
        context,
      }),
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_approved',
        data: { connection: 'c1' },
        context,
      }),
      catalog.streamKinds,
      catalog.namedTypes,
      catalog.readableBy({ permissions: ['playbook:read'], playbooks: '*' })({ kind: 'connection', connection: 'c1' }),
    ]).toEqual([
      [{ kind: 'connection', connection: 'c1' }],
      [{ kind: 'connection', connection: 'c2' }],
      [],
      ['connections'],
      [
        'connection_added',
        'connection_client_given',
        'connection_consent_started',
        'connection_connected',
        'connection_broken',
        'connection_removed',
      ],
      false,
    ]);
  });
});

describe('the change a client of the org’s own app makes', () => {
  it('names the connection given it by its id, since its record holds the client id', () => {
    expect(
      catalog.changesOf({
        id: 'm1',
        stream: 'connections',
        type: 'connection_client_given',
        data: { connection: 'c3', client_id: 'org-app', secret_id: 'secret-4' },
        context,
      }),
    ).toEqual([{ kind: 'connection', connection: 'c3' }]);
  });
});

const started = {
  connection: 'c1',
  state_sha256: 'a1b2',
  verifier_secret_id: 'secret-1',
  client_id: 'auto-runtime',
  client_source: 'registered',
  expires_at: '2026-10-05T09:10:00.000Z',
};

function startedWith(data: Readonly<Record<string, unknown>>) {
  return catalog.changesOf({ id: 'm1', stream: 'connections', type: 'connection_consent_started', data, context });
}

describe('the change a start of a consent makes', () => {
  it('names the connection where the consent asks scopes it had not asked, and nothing where it asks none more or an earlier release recorded it', () => {
    expect([
      startedWith({ ...started, scope: 'files.read files.share', says: { 'files.share': 'Share the files.' } }),
      startedWith({ ...started, scope: 'files.read', says: {} }),
      startedWith(started),
    ]).toEqual([[{ kind: 'connection', connection: 'c1' }], [], []]);
  });
});
