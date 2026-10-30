import type { makeCatalog } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { addNote, getNote, latestNote } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const notes = '/v1/orgs/acme/playbooks/alpha/notes';

const catalogOrders: ReadonlyArray<readonly [string, Parameters<typeof makeCatalog>[0]]> = [
  ['the parameterised path first', [addNote, getNote, latestNote]],
  ['the literal path first', [addNote, latestNote, getNote]],
];

describe('the order of the routes of a catalog', () => {
  it('lets the literal path answer with its own rejection', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, `${notes}/latest`, { headers: asAdmin })).toMatchObject({
      status: 404,
      body: { detail: 'The playbook has no notes' },
    });
  });

  it.each(catalogOrders)(
    'lets a literal segment win over a parameter at the same position, with %s',
    async (_order, operations) => {
      const { handler } = await operationServer({ operations });
      await call(handler, notes, {
        method: 'POST',
        headers: { ...asAdmin, 'content-type': 'application/json' },
        body: '{"name":"first","text":"hello"}',
      });

      expect(await call(handler, `${notes}/latest`, { headers: asAdmin })).toMatchObject({
        status: 200,
        body: { name: 'first' },
      });
      expect(await call(handler, `${notes}/first`, { headers: asAdmin })).toMatchObject({ status: 200 });
    },
  );
});
