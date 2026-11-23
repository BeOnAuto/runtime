import type { ProjectedKeyedRow, ProjectedRowsQuery, RowsAddress } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { listenedConnectionsOf } from './listened-connections.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const triggers = [
  {
    kind: 'event',
    reference: '/schedule/on',
    filters: [
      {
        reference: '/schedule/on/any/0',
        type: 'opened',
        attributes: { type: 'opened', source: '/connections/tracker' },
      },
      {
        reference: '/schedule/on/any/1',
        type: 'closed',
        attributes: { type: 'closed', source: '/connections/tracker', subject: 'board-1' },
      },
      {
        reference: '/schedule/on/any/2',
        type: 'booking.created',
        attributes: { type: 'booking.created', source: '/connections/bookings' },
        read: { tool: 'list_bookings', list: '/bookings', order: 'oldest_first', id: ['/id'] },
      },
      { reference: '/schedule/on/any/3', type: 'closed', attributes: { type: 'closed', source: '/ledger/eu' } },
      { reference: '/schedule/on/any/4', type: 'closed', attributes: { type: 'closed' } },
    ],
  },
  { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
];

const rows: readonly ProjectedKeyedRow[] = [
  { org: 'acme', key: 'workflow/on-items', row: { name: 'on-items', triggers: JSON.stringify(triggers) } },
  { org: 'acme', key: 'workflow/quiet', row: { name: 'quiet', triggers: null } },
  { org: 'acme', key: 'workflow/unread', row: { name: 'unread', triggers: '[{"kind":"comet"}]' } },
];

describe('the connections the active workflows of a playbook listen through', () => {
  it('are read from the definitions read model, each filter that names a connection with its workflow, type, subject and read', async () => {
    const asked: (readonly [string, RowsAddress, ProjectedRowsQuery])[] = [];
    const ledger = {
      readProjectedRows: (table: string, address: RowsAddress, query: ProjectedRowsQuery) =>
        Effect.sync(() => {
          asked.push([table, address, query]);
          return rows;
        }),
    };

    const listened = await Effect.runPromise(listenedConnectionsOf(ledger, alpha));

    expect(listened).toEqual([
      { workflow: 'on-items', connection: 'tracker', type: 'opened' },
      { workflow: 'on-items', connection: 'tracker', type: 'closed', subject: 'board-1' },
      {
        workflow: 'on-items',
        connection: 'bookings',
        type: 'booking.created',
        read: { tool: 'list_bookings', list: '/bookings', order: 'oldest_first', id: ['/id'] },
      },
    ]);
    expect(asked).toMatchObject([
      [
        'definitions',
        alpha,
        {
          where: [
            { column: 'definition_type', equals: 'workflow' },
            { column: 'status', equals: 'active' },
          ],
        },
      ],
    ]);
  });
});
