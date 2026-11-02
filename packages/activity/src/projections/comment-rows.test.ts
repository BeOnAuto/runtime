import type { ProjectedRow } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { financePrefix, projected } from '../testing/projected.ts';
import { messageOf, type RecordedFact } from '../testing/recorded-facts.ts';
import { commentRows } from './comment-rows.ts';

const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

const id = (index: number) => `019a4120-5b6c-7d8e-9f01-${String(index).padStart(12, '0')}`;

const priya = { id: 'person:user_7kLm2', name: 'Priya Raman' };

const at = (minute: number) => `2026-11-02T10:${String(minute).padStart(2, '0')}:00.000Z`;

function made(address: string, minute = 0): RecordedFact {
  return {
    type: 'comment_made',
    data: { address, text: 'Flag it.', made_by: priya },
    context: { at: at(minute), by: priya.id },
  };
}

function resolved(how: string, minute: number): RecordedFact {
  return { type: 'comment_resolved', data: { how }, context: { at: at(minute), by: 'person:user_3pQr8' } };
}

const stream = (index: number) => `${financePrefix}comments/${id(index)}`;

const about = (row: ProjectedRow | undefined) => [
  row?.['about_run'],
  row?.['about_version'],
  row?.['about_definition'],
];

describe('the comments of a playbook', () => {
  it('keeps each comment made, open, keyed by its id, with what its address is about for the reads under it', async () => {
    const { record, rows } = projected(commentRows);
    await record(stream(1), made('finance/definitions/workflow/close-the-week/4/steps/do/1/review'));

    expect((await rows())[id(1)]).toEqual({
      address: 'finance/definitions/workflow/close-the-week/4/steps/do/1/review',
      text: 'Flag it.',
      by: priya.id,
      by_name: priya.name,
      at: Date.parse(at(0)),
      open: true,
      resolved_at: null,
      resolved_by: null,
      resolved_how: null,
      about_run: null,
      about_version: 'workflow/close-the-week/4',
      about_definition: 'workflow/close-the-week',
    });
  });

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
    ];
    await addresses.reduce(
      (done: Promise<void>, address, index) => done.then(() => record(stream(index), made(address))),
      Promise.resolve(),
    );
    const kept = await rows();

    expect(addresses.map((_, index) => about(kept[id(index)]))).toEqual([
      [run, null, null],
      [run, null, null],
      [run, null, null],
      [null, 'reasoning/categorize-invoice/7', 'reasoning/categorize-invoice'],
      [null, null, null],
      [null, null, null],
      [null, null, null],
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
