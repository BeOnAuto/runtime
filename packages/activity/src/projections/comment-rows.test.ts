import type { ProjectedRow } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { financePrefix, projected } from '../testing/projected.ts';
import { messageOf, type RecordedFact } from '../testing/recorded-facts.ts';
import { commentRows } from './comment-rows.ts';

const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

const id = (index: number) => `019a4120-5b6c-7d8e-9f01-${String(index).padStart(12, '0')}`;

const priya = { id: 'person:user_7kLm2', name: 'Priya Raman' };

const at = (minute: number) => `2026-11-02T10:${String(minute).padStart(2, '0')}:00.000Z`;

function made(address: string, minute = 0, anchor?: { readonly x: number; readonly y: number }): RecordedFact {
  return {
    type: 'comment_made',
    data: { address, text: 'Flag it.', made_by: priya, ...(anchor === undefined ? {} : { anchor }) },
    context: { at: at(minute), by: priya.id },
  };
}

function resolved(how: string, minute: number): RecordedFact {
  return { type: 'comment_resolved', data: { how }, context: { at: at(minute), by: 'person:user_3pQr8' } };
}

function reopened(minute: number): RecordedFact {
  return { type: 'comment_reopened', data: {}, context: { at: at(minute), by: 'person:user_9xYz4' } };
}

const stream = (index: number) => `${financePrefix}comments/${id(index)}`;

const about = (row: ProjectedRow | undefined) => [
  row?.['about_run'],
  row?.['about_version'],
  row?.['about_definition'],
  row?.['about_thing'],
];

describe('the comments of a playbook', () => {
  it('keeps each comment made, open, keyed by its id, with what its address is about for the reads under it', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('finance/definitions/workflow/close-the-week/4/steps/do/1/review'));

    expect((await rows())[id(1)]).toEqual({
      address: 'finance/definitions/workflow/close-the-week/4/steps/do/1/review',
      text: 'Flag it.',
      anchor_x: null,
      anchor_y: null,
      by: priya.id,
      by_name: priya.name,
      at: Date.parse(at(0)),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: null,
      reopened_by: null,
      listed_at: Date.parse(at(0)),
      listed_by: priya.id,
      about_run: null,
      about_version: 'workflow/close-the-week/4',
      about_definition: 'workflow/close-the-week',
      about_thing: 'finance/definitions/workflow/close-the-week/4/steps/do/1/review',
    });
  });
});

describe('the anchor and the thing of a comment of a playbook', () => {
  it('keeps where on the thing a comment was dropped, in whole ten-thousandths of its box', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('playbooks/finance', 0, { x: 0.6125, y: 1 }));

    expect((await rows())[id(1)]).toMatchObject({ anchor_x: 6125, anchor_y: 10_000 });
  });
});

describe('what the address of a comment of a playbook is about', () => {
  it('names the run of a run, an event or a block, and nothing of a request, the playbook or an address it cannot read', async () => {
    const { record, rows } = projected(commentRows);
    const addresses = [
      `finance/runs/${run}`,
      `finance/runs/${run}/events/${run}_2`,
      `finance/runs/${run}/result/2`,
      'finance/definitions/reasoning/categorize-invoice/7',
      `finance/${run}`,
      'playbooks/finance',
      'finance/somewhere',
      'playbooks/finance/parts/ledger',
      'finance/definitions/reasoning/categorize-invoice/7/parts/source',
      `finance/runs/${run}/parts/output`,
    ];
    await addresses.reduce(
      (done: Promise<void>, address, index) => done.then(() => record(stream(index), made(address))),
      Promise.resolve(),
    );
    const kept = await rows();

    expect(addresses.map((_, index) => about(kept[id(index)]))).toEqual([
      [run, null, null, `finance/runs/${run}`],
      [run, null, null, `finance/runs/${run}/events/${run}_2`],
      [run, null, null, `finance/runs/${run}/result/2`],
      [
        null,
        'reasoning/categorize-invoice/7',
        'reasoning/categorize-invoice',
        'finance/definitions/reasoning/categorize-invoice/7',
      ],
      [null, null, null, `finance/${run}`],
      [null, null, null, 'playbooks/finance'],
      [null, null, null, 'finance/somewhere'],
      [null, null, null, 'playbooks/finance'],
      [
        null,
        'reasoning/categorize-invoice/7',
        'reasoning/categorize-invoice',
        'finance/definitions/reasoning/categorize-invoice/7',
      ],
      [run, null, null, `finance/runs/${run}`],
    ]);
  });
});

describe('the comments of the organization', () => {
  it('are kept on the org, keyed by their id, naming the thing a part is of and no run, version or definition', async () => {
    const { record, rows } = projected(commentRows, { org: 'acme' });
    const connection = '019a3f10-2b4c-7d5e-8f60-718293a4b5c6';
    await record(
      `org/acme/comments/${id(1)}`,
      made(`org/connections/${connection}/parts/tools`, 0, { x: 0.18, y: 0.5 }),
    );
    await record(`org/acme/comments/${id(2)}`, made('org'));
    const kept = await rows();

    expect(kept[id(1)]).toMatchObject({ anchor_x: 1800, anchor_y: 5000, open: true });
    expect([about(kept[id(1)]), about(kept[id(2)])]).toEqual([
      [null, null, null, `org/connections/${connection}`],
      [null, null, null, 'org'],
    ]);
  });
});

describe('a comment resolved', () => {
  it('closes a comment resolved, keeping it with when, by whom and how, and keeps the first resolution', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('playbooks/finance'), resolved('dismissed', 5), resolved('acted', 6));

    expect((await rows())[id(1)]).toMatchObject({
      open: false,
      resolved_at: Date.parse(at(5)),
      resolved_by: 'person:user_3pQr8',
      resolved_how: 'dismissed',
    });
  });

  it('writes nothing for a resolution of no comment, or a fact it does not read', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), resolved('acted', 5));

    expect(await rows()).toEqual({});
    expect(commentRows.rowAfter(undefined, messageOf({ ...made('playbooks/finance'), data: {} }))).toBeUndefined();
  });
});

describe('a comment reopened', () => {
  it('opens a resolved comment again, with when and by whom, listing it in the activity from then by its reopener', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('playbooks/finance'), resolved('acted', 5), reopened(7));

    expect((await rows())[id(1)]).toMatchObject({
      by: priya.id,
      at: Date.parse(at(0)),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      reopened_at: Date.parse(at(7)),
      reopened_by: 'person:user_9xYz4',
      listed_at: Date.parse(at(7)),
      listed_by: 'person:user_9xYz4',
    });
  });

  it('writes nothing for a reopening of a comment open already, or of no comment', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('playbooks/finance'), reopened(7));
    await record(stream(2), reopened(7));
    const kept = await rows();

    expect(kept[id(1)]).toMatchObject({ open: true, reopened_at: null, listed_at: Date.parse(at(0)) });
    expect(kept[id(2)]).toBeUndefined();
  });
});
