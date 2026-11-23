import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { projected } from '../testing/projected.ts';
import type { RecordedFact } from '../testing/recorded-facts.ts';
import { playbookChangeOf, playbookChangeRows, playbookChangeRowsName } from './playbook-change-rows.ts';

const ada = { id: 'person:user_2ada', name: 'Ada Lovelace' };

const at = (minute: number) => `2026-11-01T09:0${minute}:00.000Z`;

const facts: readonly RecordedFact[] = [
  {
    type: 'playbook_created',
    data: { playbook: 'alpha', name: 'Alpha', description: '', created_by: ada },
    context: { at: at(0), by: ada.id },
  },
  { type: 'playbook_retired', data: { playbook: 'alpha' }, context: { at: at(1), by: 'acme-editor' } },
  {
    type: 'playbook_updated',
    data: { playbook: 'alpha', name: 'Alpha two' },
    context: { at: at(2), by: 'acme-editor' },
  },
];

describe('the changes of the register of an org’s playbooks, a row each', () => {
  it('keep each creation and update as the row the activity shows, and nothing of a retirement', async () => {
    const { ledger, record } = projected(playbookChangeRows, { org: 'acme' });
    await record('org/acme/playbooks', ...facts);

    const rows = await Effect.runPromise(
      ledger.service.readProjectedRows(
        playbookChangeRowsName,
        { org: 'acme' },
        { where: [], orderBy: ['position'], order: 'asc', limit: 10 },
      ),
    );
    const changes = rows.map((row) => playbookChangeOf(row));

    expect(changes).toMatchObject([
      {
        kind: 'new',
        form: 'playbook',
        by: ada.id,
        change: 'created',
        position: { at: Date.parse(at(0)), playbook: 'alpha' },
      },
      { kind: 'new', form: 'playbook', by: 'acme-editor', change: 'updated', position: { at: Date.parse(at(2)) } },
    ]);
  });

  it('change no row they already keep, and keep nothing of a fact they cannot read or of a retirement handed them', () => {
    const message = { id: 'm1', position: 1, type: 'playbook_created', data: {}, context: { at: at(0), by: ada.id } };
    const retired = { ...message, type: 'playbook_retired', data: { playbook: 'alpha' } };

    expect([
      playbookChangeRows.rowAfter({ playbook: 'alpha' }, message),
      playbookChangeRows.rowAfter(undefined, message),
      playbookChangeRows.rowAfter(undefined, retired),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
