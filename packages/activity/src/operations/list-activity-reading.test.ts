import type { Ledger } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  ada,
  entitiesOverTheWire,
  firstCursorOf,
  listedOf,
  localDeveloper,
  priya,
  salesReader,
} from '../testing/harness.ts';
import { runFailed } from '../testing/recorded-facts.ts';
import { definitionStreamOf, filed, financeAndSales, runStreamOf, runs } from '../testing/scenario.ts';

const addresses = (rows: readonly { readonly address: string }[]) => rows.map(({ address }) => address);

describe('what list_activity counts as waiting on the caller', () => {
  it('counts a request for any member, never one an address names, and every request for the local developer', async () => {
    const { list } = await financeAndSales();
    const requests = listedOf(await list(ada, { kind: 'needs_you' }));

    expect(addresses(requests.rows)).toEqual([`finance/${runs.askedDana.runId}`, `finance/${runs.askedAnyone.runId}`]);
    expect(requests.counts).toEqual({ needs_you: 1, broken: 1, new: 3, comments: 0 });
    expect(listedOf(await list(localDeveloper)).counts).toEqual({ needs_you: 2, broken: 1, new: 5, comments: 0 });
  });

  it('counts the same whatever the filters and the page', async () => {
    const { list } = await financeAndSales();

    expect(listedOf(await list(ada, { kind: 'broken', playbook: 'sales', limit: '1' })).counts).toEqual({
      needs_you: 1,
      broken: 1,
      new: 3,
      comments: 0,
    });
  });
});

describe('the filters of list_activity', () => {
  it('keeps the rows of the kinds asked, of one playbook, and of the new rows those the caller did', async () => {
    const { list } = await financeAndSales();

    expect(addresses(listedOf(await list(ada, { kind: 'needs_you, broken' })).rows)).toEqual([
      `finance/${runs.askedDana.runId}`,
      `finance/${runs.askedAnyone.runId}`,
      'finance/reasoning/categorize-invoice',
    ]);
    expect(addresses(listedOf(await list(ada, { playbook: 'sales', kind: 'new' })).rows)).toHaveLength(4);
    expect(addresses(listedOf(await list(ada, { mine: 'true' })).rows)).toEqual([
      `sales/runs/${runs.sold.runId}`,
      `finance/${runs.askedDana.runId}`,
      `finance/${runs.askedAnyone.runId}`,
      'finance/reasoning/categorize-invoice',
      expect.stringMatching(/^playbooks\/sales\//u),
    ]);
  });

  it('lists to a caller of some playbooks the playbook they name', async () => {
    const { list } = await financeAndSales();

    expect(listedOf(await list(salesReader, { playbook: 'sales' })).counts).toEqual({
      needs_you: 0,
      broken: 0,
      new: 2,
      comments: 0,
    });
  });
});

describe('the playbooks of list_activity', () => {
  it('lists each change of a playbook as its own row, and nothing of a playbook retired', async () => {
    const { list, updated, retired } = await financeAndSales();
    await updated(ada, 'finance', '2026-11-01T15:00:00.000Z');
    await retired(ada, 'sales', '2026-11-01T15:01:00.000Z');
    const { rows, counts } = listedOf(await list(priya));

    expect(rows[0]).toMatchObject({
      address: `playbooks/finance/${Date.parse('2026-11-01T15:00:00.000Z')}`,
      seen: false,
    });
    expect(rows.filter(({ address }) => /^(?:playbooks\/)?sales\//u.test(address))).toEqual([]);
    expect(counts).toEqual({ needs_you: 1, broken: 1, new: 1, comments: 0 });
    expect(listedOf(await list(priya, { playbook: 'sales' })).rows).toEqual([]);
  });

  it('lists a restored playbook as it was before its retirement, its restoration no row of its own', async () => {
    const before = listedOf(await (await financeAndSales()).list(priya));
    const { list, retired, restored } = await financeAndSales();
    await retired(ada, 'sales', '2026-11-01T15:01:00.000Z');
    await restored(ada, 'sales', '2026-11-01T15:02:00.000Z');

    expect(listedOf(await list(priya))).toEqual(before);
  });

  it('names who started the run of a broken definition, or who ended it where the start is not kept', async () => {
    const { list, record } = await financeAndSales();
    const failed = {
      runId: '019a4000-0000-7000-8000-0000000000ff',
      type: 'computation',
      name: 'sum-invoices',
      version: 1,
    };
    const sumInvoices = { id: '019a3f00-0000-7000-8000-0000000000ff', ...failed, playbook: 'finance' };
    await record(definitionStreamOf(sumInvoices), filed(sumInvoices, '2026-11-01T14:59:00.000Z', priya.id));
    await record(runStreamOf(sumInvoices, failed), runFailed(failed, '2026-11-01T15:00:00.000Z'));

    expect(listedOf(await list(ada, { kind: 'broken' })).rows).toMatchObject([
      { address: 'finance/computation/sum-invoices', by: 'playbook:finance' },
      { address: 'finance/reasoning/categorize-invoice', by: ada.id },
    ]);
  });
});

interface Counting {
  readonly entities: () => void;
  readonly playbookRead: () => void;
}

function countedReads({ entities, playbookRead }: Counting) {
  return (ledger: Ledger['Service']): Ledger['Service'] => ({
    ...ledger,
    readProjectedRows: (projection, address, query) => {
      [address.playbook]
        .filter((playbook) => playbook !== undefined)
        .forEach(() => {
          playbookRead();
        });
      return ledger.readProjectedRows(projection, address, query);
    },
    countProjectedRows: (projection, address, where) => {
      [address.playbook]
        .filter((playbook) => playbook !== undefined)
        .forEach(() => {
          playbookRead();
        });
      return ledger.countProjectedRows(projection, address, where);
    },
    namesHeldIn: (kind) => {
      [kind.playbookKey]
        .filter((key) => key.startsWith('playbook/'))
        .forEach(() => {
          playbookRead();
        });
      return ledger.namesHeldIn(kind);
    },
    readEntitiesAcross: (kind, org, keys, asked) => {
      entities();
      return entitiesOverTheWire(ledger, { kind, org, keys, asked });
    },
  });
}

describe('the reads of list_activity and mark_activity_seen', () => {
  it('read the activity of every playbook the caller may access in one read of entities, sent and answered as values, and no row of a playbook outside it', async () => {
    const counted = { entities: 0, playbookReads: 0 };
    const counting: Counting = {
      entities: () => {
        counted.entities += 1;
      },
      playbookRead: () => {
        counted.playbookReads += 1;
      },
    };
    const inProcess = listedOf(await (await financeAndSales()).list(ada));
    const { list, mark } = await financeAndSales(countedReads(counting));
    counted.entities = 0;
    counted.playbookReads = 0;

    const listed = await list(ada);
    const afterTheList = { entities: counted.entities, playbookReads: counted.playbookReads };
    await mark(ada, { through: firstCursorOf(listed) });

    expect(listedOf(listed)).toEqual(inProcess);
    expect([afterTheList, { entities: counted.entities, playbookReads: counted.playbookReads }]).toEqual([
      { entities: 1, playbookReads: 0 },
      { entities: 2, playbookReads: 0 },
    ]);
  });
});
