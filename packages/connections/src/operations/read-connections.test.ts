import { describe, expect, it } from 'vitest';

import { added, billing, crm, namesIn, notes } from '../testing/additions.ts';
import { acmeReader, acmeViewer, ada, harness, operationNamed } from '../testing/harness.ts';

const earlier = '2026-10-15T13:00:00.000Z';

describe('listing the connections of an org', () => {
  it('answers them newest first, and the removed ones only when asked', async () => {
    const h = harness();
    await added(h, notes, { at: earlier });
    const { id } = await added(h, billing);
    await added(h, crm);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
    const listing = operationNamed(h.operations, 'list_connections');

    const names = async (input: unknown) => namesIn(await h.call(listing, acmeReader, input));

    expect(await names({})).toEqual(['crm', 'notes']);
    expect(await names({ include_removed: true })).toEqual(['crm', 'billing', 'notes']);
  });

  it('is permitted by org:read and refused to a caller who may only read playbooks', async () => {
    const h = harness();

    const outcome = await h.call(operationNamed(h.operations, 'list_connections'), acmeViewer);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('reading one connection', () => {
  it('answers its record, and an id the org does not have as not found', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const getting = operationNamed(h.operations, 'get_connection');

    expect(await h.call(getting, acmeReader, { id })).toMatchObject({
      status: 'succeeded',
      output: { id, name: 'notes', status: 'pending', credential: { kind: 'none' } },
    });
    expect(await h.call(getting, acmeReader, { id: 'nowhere' })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no connection nowhere in this org',
    });
  });
});
