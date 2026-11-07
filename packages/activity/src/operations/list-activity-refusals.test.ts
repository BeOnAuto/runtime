import { describe, expect, it } from 'vitest';

import { cursorOf } from '../positions/activity-position.ts';
import { ada, salesReader } from '../testing/harness.ts';
import { financeAndSales } from '../testing/scenario.ts';

describe('what list_activity refuses', () => {
  const refused: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
    [{ kind: 'comments' }, '/kind'],
    [{ kind: '' }, '/kind'],
    [{ cursor: 'not a cursor' }, '/cursor'],
    [{ since: cursorOf({ at: 1, playbook: 'payroll', key: 'runs/x' }) }, '/since'],
    [{ address: 'dana@example.com' }, '/address'],
    [{ limit: '0' }, '/limit'],
    [{ limit: '201' }, '/limit'],
  ];

  it.each(refused)('refuses %o as invalid input at %s', async (input, pointer) => {
    const { list } = await financeAndSales();

    expect(await list(ada, input)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('answers not found for a playbook the org does not have, and forbidden for one the caller may not access', async () => {
    const { list } = await financeAndSales();

    expect(await list(ada, { playbook: 'payroll' })).toMatchObject({ status: 'rejected', reason: 'not_found' });
    expect(await list(salesReader, { playbook: 'finance' })).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(await list(salesReader)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
