import { describe, expect, it } from 'vitest';

import { ada, listedOf, outputOf, priya } from '../testing/harness.ts';
import { at, financeAndSales, runs } from '../testing/scenario.ts';
import { listActivity } from './list-activity.ts';

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
