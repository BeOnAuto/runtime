import { describe, expect, it } from 'vitest';

import { added, billing, crm } from '../testing/additions.ts';
import { acmeReader, ada, harness, operationNamed } from '../testing/harness.ts';

describe('setting the account type of a connection', () => {
  it('records the type and answers the connection as reading it answers it', async () => {
    const h = harness();
    const { id } = await added(h, crm);

    const outcome = await h.call(operationNamed(h.operations, 'set_connection_account_type'), ada, {
      id,
      account_type: 'service',
    });

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { id, account_type: 'service', credential_ends_with: null },
    });
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_account_type_set',
      data: { connection: id, account_type: 'service' },
    });
  });

  it.each([
    ['a connection that acts as the app', ada, 'conflict'],
    ['a caller who may only read the org', acmeReader, 'forbidden'],
  ])('refuses %s, recording nothing', async (_case, caller, reason) => {
    const h = harness();
    const { id } = await added(h, billing);
    const before = (await h.facts()).length;

    const outcome = await h.call(operationNamed(h.operations, 'set_connection_account_type'), caller, {
      id,
      account_type: 'personal',
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason });
    expect((await h.facts()).length).toBe(before);
  });
});
