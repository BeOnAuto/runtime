import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cursorOf } from '../positions/activity-position.ts';
import { ada, listedOf, markedOf, priya, salesReader } from '../testing/harness.ts';
import { at, financeAndSales, runs } from '../testing/scenario.ts';
import { markActivitySeen } from './mark-activity-seen.ts';

const closed = { address: `finance/runs/${runs.closed.runId}`, at: at('13:05') };

describe('what mark_activity_seen refuses', () => {
  const refused: readonly (readonly [Schema.JsonObject, string])[] = [
    [{}, '/items'],
    [{ items: [] }, '/items'],
    [{ items: Array.from({ length: 201 }, () => closed) }, '/items'],
    [{ items: [closed, { address: 'finance/runs/nope', at: closed.at }] }, '/items/1'],
    [{ items: [{ ...closed, at: 'yesterday' }] }, '/items/0'],
    [{ items: [{ ...closed, at: '2026-13-45T99:99:99Z' }] }, '/items/0'],
    [{ through: 'not a cursor' }, '/through'],
    [{ through: cursorOf({ at: 1, playbook: 'payroll', key: 'runs/x' }) }, '/through'],
    [{ items: [closed], address: 'dana@example.com' }, '/address'],
  ];

  it.each(refused)('refuses %o as invalid input at %s', async (input, pointer) => {
    const { mark } = await financeAndSales();

    expect(await mark(ada, input)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('forbids marking an item of a playbook the caller may not access', async () => {
    const { mark } = await financeAndSales();

    expect(await mark(salesReader, { items: [closed] })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may not access the playbook finance',
    });
  });

  it("forbids a caller limited to some playbooks marking the organization's comments, in words that name them", async () => {
    const { mark } = await financeAndSales();
    const ofTheOrg = { address: `org/comments/${runs.closed.runId}`, at: at('13:05') };

    expect(await mark(salesReader, { items: [ofTheOrg] })).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail:
        "The caller may not mark the organization's comments, which only a caller who may access every playbook sees",
    });
  });
});

describe('mark_activity_seen', () => {
  it('is a command of the org at POST /activity/seen, over HTTP alone, for a reader of the org or its playbooks', () => {
    expect(markActivitySeen.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      name: 'mark_activity_seen',
      route: { method: 'POST', path: '/activity/seen' },
      servedOverHttpAlone: { kind: 'json' },
      permissions: ['org:read', 'playbook:read'],
    });
  });

  it('marks the items the caller has seen, for that caller alone, and answers the counts after it', async () => {
    const { list, mark } = await financeAndSales();
    const marked = markedOf(
      await mark(ada, { items: [closed, { address: `finance/${runs.askedAnyone.runId}`, at: at('12:01') }] }),
    );
    const rows = listedOf(await list(ada)).rows;

    expect(marked).toEqual({ counts: { needs_you: 1, broken: 1, new: 2, comments: 0 }, through: null });
    expect(rows.find(({ address }) => address === closed.address)).toMatchObject({ seen: true });
    expect(listedOf(await list(priya)).counts.new).toBe(2);
  });
});

describe('mark_activity_seen through a cursor', () => {
  it('marks everything through a cursor, which never moves back, and answers where it stands', async () => {
    const { list, mark } = await financeAndSales();
    const [newest, second] = listedOf(await list(ada)).rows.map(({ cursor }) => cursor);
    const marked = markedOf(await mark(ada, { through: String(newest) }, '2026-11-01T18:30:00.000Z'));
    const after = markedOf(await mark(ada, { through: String(second) }));

    expect(marked).toEqual({
      counts: { needs_you: 1, broken: 1, new: 0, comments: 0 },
      through: { cursor: newest, seen_at: '2026-11-01T18:30:00.000Z' },
    });
    expect(after).toEqual(marked);
  });

  it('counts a new row marked seen once only, whatever else is marked', async () => {
    const { mark } = await financeAndSales();
    const others = [
      { address: `sales/runs/${runs.sold.runId}`, at: at('14:01') },
      { address: `finance/runs/${runs.askedDana.runId}`, at: at('12:11') },
      { address: 'finance/reasoning/categorize-invoice', at: at('11:01') },
      { address: 'finance/definitions/reasoning/categorize-invoice/1', at: at('10:05') },
    ];

    expect(markedOf(await mark(ada, { items: [closed, closed, ...others] })).counts).toEqual({
      needs_you: 1,
      broken: 1,
      new: 1,
      comments: 0,
    });
  });
});
