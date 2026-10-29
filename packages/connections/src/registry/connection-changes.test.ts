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
      ['connection_added', 'connection_connected', 'connection_broken', 'connection_removed'],
      false,
    ]);
  });
});
