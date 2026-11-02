import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cursorOf } from '../positions/activity-position.ts';
import { ada, salesReader } from '../testing/harness.ts';
import { at, financeAndSales, runs } from '../testing/scenario.ts';

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
    [{ items: [closed], address: 'dana' }, '/address'],
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
