import { describe, expect, it } from 'vitest';

import { ada, listedOf } from '../testing/harness.ts';
import { financeAndSales } from '../testing/scenario.ts';

const addresses = (rows: readonly { readonly address: string }[]) => rows.map(({ address }) => address);

describe('the pages of list_activity', () => {
  it('reads every row once, page after page, by the cursor of the page before', async () => {
    const { list } = await financeAndSales();
    const all = addresses(listedOf(await list(ada)).rows);
    const first = listedOf(await list(ada, { limit: '4' }));
    const second = listedOf(await list(ada, { limit: '4', cursor: String(first.next_cursor) }));
    const third = listedOf(await list(ada, { limit: '4', cursor: String(second.next_cursor) }));

    expect([first.has_more, second.has_more, third.has_more]).toEqual([true, true, false]);
    expect(third.next_cursor).toBeNull();
    expect([...addresses(first.rows), ...addresses(second.rows), ...addresses(third.rows)]).toEqual(all);
  });

  it('goes on between rows of the same time, ordered by playbook and key', async () => {
    const { list } = await financeAndSales();
    const all = listedOf(await list(ada)).rows;
    const tiedFirst = all.findIndex(({ address }) => address.startsWith('playbooks/sales/'));
    const after = listedOf(await list(ada, { cursor: String(all.map(({ cursor }) => cursor)[tiedFirst]) }));

    expect(addresses(after.rows)).toEqual(addresses(all.slice(tiedFirst + 1)));
  });
});

describe('the rows of list_activity after a cursor', () => {
  it('keeps the rows after the row since names, ties at its time included', async () => {
    const { list } = await financeAndSales();
    const all = listedOf(await list(ada)).rows;
    const tiedLast = all.findIndex(({ address }) => address.startsWith('playbooks/finance/'));
    const since = listedOf(await list(ada, { since: String(all.map(({ cursor }) => cursor)[tiedLast]) }));

    expect(addresses(since.rows)).toEqual(addresses(all.slice(0, tiedLast)));
  });

  it('completes the rows of the oldest time a full read of a table reaches', async () => {
    const { list, record } = await financeAndSales();
    const versions = [2, 3, 4].map((version) => ({
      type: 'definition_updated',
      data: { content: { source: 'source' } },
      context: {
        at: '2026-11-01T15:00:00.000Z',
        by: 'x',
        definitionType: 'reasoning',
        definitionName: 'categorize-invoice',
        definitionVersion: version,
      },
    }));
    await record('playbook/acme/finance/definitions/reasoning', ...versions);
    const first = listedOf(await list(ada, { limit: '1', kind: 'new' }));
    const second = listedOf(await list(ada, { limit: '1', kind: 'new', cursor: String(first.next_cursor) }));
    const third = listedOf(await list(ada, { limit: '1', kind: 'new', cursor: String(second.next_cursor) }));

    expect([...addresses(first.rows), ...addresses(second.rows), ...addresses(third.rows)]).toEqual([
      'finance/definitions/reasoning/categorize-invoice/4',
      'finance/definitions/reasoning/categorize-invoice/3',
      'finance/definitions/reasoning/categorize-invoice/2',
    ]);
  });
});
