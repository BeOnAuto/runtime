import { checkedProjection } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { memoryLayoutSteps } from './memory-layout.ts';
import { memoryRows } from './memory-rows.ts';

const context = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

describe('the rows of the memories', () => {
  it('are a projection of one row a memory, over the memories of a playbook and of an organization', () => {
    expect(checkedProjection(memoryRows)).toMatchObject({
      name: 'memories',
      version: 1,
      scopes: ['playbook', 'org'],
      kinds: ['memories'],
      indexes: [
        { name: 'by_status', columns: ['status', 'written_at', 'row_key'] },
        { name: 'by_written_at', columns: ['written_at', 'row_key'] },
      ],
    });
  });

  it('make no row of a fact that ends a memory they hold no row of, nor of one they cannot read', () => {
    expect([
      memoryRows.rowAfter(undefined, {
        id: 'm-1',
        position: 1,
        type: 'memory_forgotten',
        data: { version: 1 },
        context,
      }),
      memoryRows.rowAfter(undefined, {
        id: 'm-1',
        position: 1,
        type: 'memory_moved',
        data: { to: 'organization', as: 'x' },
        context,
      }),
      memoryRows.rowAfter(undefined, { id: 'm-1', position: 1, type: 'memory_forgotten', data: {}, context }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('take the tenth layout of the ledger, whose table the ledger makes and fills as it opens', () => {
    expect(memoryLayoutSteps).toEqual([{ layout: 10, statements: [] }]);
  });
});
