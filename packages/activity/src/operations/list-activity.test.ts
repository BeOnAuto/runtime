import type { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cursorOf } from '../positions/activity-position.ts';
import { activityHarness, ada, listedOf, outputOf, priya, salesReader } from '../testing/harness.ts';
import { runDeferred, runStarted } from '../testing/recorded-facts.ts';
import { at, financeAndSales, runs } from '../testing/scenario.ts';
import { listActivity } from './list-activity.ts';

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

function playbooksReadAtOnce() {
  const reading = new Map<string, number>();
  const most = { playbooks: 0 };
  const began = (playbook: string) =>
    Effect.sync(() => {
      reading.set(playbook, (reading.get(playbook) ?? 0) + 1);
      most.playbooks = Math.max(most.playbooks, reading.size);
    });
  const ended = (playbook: string) =>
    Effect.sync(() => {
      const left = (reading.get(playbook) ?? 0) - 1;
      if (left === 0) {
        reading.delete(playbook);
      } else {
        reading.set(playbook, left);
      }
    });
  const watched = <A, E, R>(playbook: string | undefined, read: Effect.Effect<A, E, R>) =>
    playbook === undefined
      ? read
      : Effect.acquireUseRelease(
          began(playbook),
          () => Effect.andThen(Effect.yieldNow, read),
          () => ended(playbook),
        );
  const reads = (ledger: Ledger['Service']): Ledger['Service'] => ({
    ...ledger,
    readProjectedRows: (projection, address, query) =>
      watched(address.playbook, ledger.readProjectedRows(projection, address, query)),
    countProjectedRows: (projection, address, where) =>
      watched(address.playbook, ledger.countProjectedRows(projection, address, where)),
  });
  return { most, reads };
}

describe('the playbooks list_activity reads', () => {
  it('are read at once, each playbook’s rows beside the others’, and answered as they are kept', async () => {
    const watching = playbooksReadAtOnce();
    const watched = await financeAndSales(watching.reads);
    const unwatched = await financeAndSales();

    const [listed, asKept] = [listedOf(await watched.list(ada)), listedOf(await unwatched.list(ada))];

    expect(listed).toEqual(asKept);
    expect(watching.most.playbooks).toBe(2);
  });
});

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

const ms = (time: string) => Date.parse(at(time));

describe('list_activity', () => {
  it('is a query of the org at GET /activity, over HTTP alone, for a reader of the org or its playbooks', () => {
    expect(listActivity.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_activity',
      route: { method: 'GET', path: '/activity' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['org:read', 'playbook:read'],
    });
  });

  it('lists the requests, the broken definitions and what is new, newest first, with what the caller has seen', async () => {
    const { list } = await financeAndSales();

    expect(outputOf(await list(ada))).toMatchObject({
      rows: [
        { kind: 'new', address: `sales/runs/${runs.sold.runId}`, by: ada.id, seen: true },
        { kind: 'new', address: `finance/runs/${runs.closed.runId}`, by: priya.id, output_shape: 'table', seen: false },
        { kind: 'needs_you', address: `finance/${runs.askedDana.runId}`, waits_on: 'dana@example.com', seen: null },
        {
          kind: 'needs_you',
          address: `finance/${runs.askedAnyone.runId}`,
          waits_on: 'any_member',
          message: 'Approve this?',
        },
        { kind: 'broken', address: 'finance/reasoning/categorize-invoice', by: ada.id, status: 'failed', detail: null },
        { kind: 'new', address: 'finance/definitions/reasoning/categorize-invoice/1', change: 'created', seen: false },
        { kind: 'new', address: `playbooks/sales/${ms('10:00')}`, change: 'created', by: ada.id, seen: true },
        { kind: 'new', address: `playbooks/finance/${ms('10:00')}`, change: 'created', by: priya.id, seen: false },
        { kind: 'new', address: 'sales/definitions/workflow/old-report/1', seen: true },
      ],
      has_more: false,
      next_cursor: null,
      counts: { needs_you: 1, broken: 1, new: 3, comments: 0 },
      through: null,
    });
  });
});

describe('a row of list_activity', () => {
  it('serves each row whole, its times in ISO 8601 and its answer schema as JSON', async () => {
    const { list } = await financeAndSales();
    const output = await list(ada, { kind: 'needs_you', limit: '1' });
    const [row] = listedOf(output).rows;

    expect(row?.cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(outputOf(output)).toMatchObject({
      rows: [
        {
          kind: 'needs_you',
          address: `finance/${runs.askedDana.runId}`,
          playbook: 'finance',
          at: at('12:11'),
          by: priya.id,
          change: null,
          trigger: null,
          definition: { type: 'interaction', name: 'approve-payment', version: 1 },
          run_id: runs.askedDana.runId,
          output_shape: null,
          message: 'Approve this?',
          answer_schema: { type: 'boolean' },
          detail: null,
          status: null,
          waits_on: 'dana@example.com',
          expires_at: '2026-11-03T12:00:00.000Z',
          seen: null,
        },
      ],
    });
  });
});

describe('a request in list_activity whose party is a person by id', () => {
  it('waits on that person, counted for them alone', async () => {
    const harness = activityHarness();
    const asking = {
      runId: '019a4000-0000-7000-8000-000000000009',
      type: 'interaction',
      name: 'portal-check',
      version: 1,
    };
    await harness.created(priya, 'finance', at('10:00'));
    await harness.record(
      `playbook/acme/finance/runs/${asking.runId}`,
      runStarted(asking, at('11:00'), 'playbook:finance'),
      runDeferred(asking, at('11:01'), {
        to: priya.id,
        message: 'Is the supplier portal order still open?',
        expiresAt: '2026-11-02T11:01:00.000Z',
        answerSchema: { type: 'object' },
      }),
    );

    expect([outputOf(await harness.list(priya)), outputOf(await harness.list(ada))]).toMatchObject([
      { rows: [{ kind: 'needs_you', waits_on: priya.id }, { kind: 'new' }], counts: { needs_you: 1 } },
      { counts: { needs_you: 0 } },
    ]);
  });
});
