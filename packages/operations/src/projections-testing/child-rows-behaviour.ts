import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerPorts } from '../ledger/ledger.ts';
import type { KeptProjection, ProjectedRowsQuery } from '../projections/keyed-projection.ts';
import { labelFacts, labelRows, labelRowsByNote, type LabelFact } from '../projections/label-rows.ts';

export type ChildRowsLedger = (projections: readonly KeptProjection[]) => Promise<LedgerPorts>;

const alpha = { org: 'acme', playbook: 'alpha' };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

function labelled(ledger: LedgerPorts, stream: string, ...facts: readonly LabelFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, labelFacts, facts));
}

function set(note: string, ...labels: readonly string[]): LabelFact {
  return { type: 'labels_set', data: { note, labels } };
}

function added(note: string, label: string): LabelFact {
  return { type: 'label_added', data: { note, label } };
}

function cleared(note: string): LabelFact {
  return { type: 'labels_cleared', data: { note } };
}

async function keysOf(
  ledger: LedgerPorts,
  projection: string,
  query: ProjectedRowsQuery = everyRow,
): Promise<readonly (readonly [string, string | undefined, unknown])[]> {
  const rows = await Effect.runPromise(ledger.readProjectedRows(projection, alpha, query));
  return rows.map(({ key, child, row }) => [key, child, row['place']]);
}

function rowsKeptUnderAKey(open: ChildRowsLedger): void {
  describe('a projection that keeps several rows under one key', () => {
    it('keeps the rows its mapping answers for the key after each fact, the key’s rows before handed to it, and reads each with its child key', async () => {
      const ledger = await open([labelRows]);
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent', 'billing'), added('n1', 'later'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', added('n1', 'urgent'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n2', set('n2', 'billing'));
      await labelled(ledger, 'playbook/acme/alpha/others/o1', set('n1', 'ignored'));

      expect(await keysOf(ledger, 'labels')).toEqual([
        ['n1', 'billing', 2],
        ['n1', 'later', 3],
        ['n1', 'urgent', 1],
        ['n2', 'billing', 1],
      ]);
      expect(await Effect.runPromise(ledger.readProjectedRows('labels', alpha, { ...everyRow, limit: 1 }))).toEqual([
        {
          org: 'acme',
          playbook: 'alpha',
          key: 'n1',
          child: 'billing',
          row: { label: 'billing', place: 2, set_at: 1 },
        },
      ]);
    });
  });
}

function rowsDroppedUnderAKey(open: ChildRowsLedger): void {
  describe('a projection that keeps several rows under one key', () => {
    it('drops the rows of a key its mapping no longer answers, and leaves those of other keys', async () => {
      const ledger = await open([labelRows]);
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent', 'billing'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n2', set('n2', 'billing'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent'));
      const replaced = await keysOf(ledger, 'labels');
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', cleared('n1'));

      expect([replaced, await keysOf(ledger, 'labels')]).toEqual([
        [
          ['n1', 'urgent', 1],
          ['n2', 'billing', 1],
        ],
        [['n2', 'billing', 1]],
      ]);
    });
  });
}

function rowsReadUnderAKey(open: ChildRowsLedger): void {
  describe('a projection that keeps several rows under one key', () => {
    it('reads by the child key and the columns, from where a page ended, in either order, and counts', async () => {
      const ledger = await open([labelRows]);
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'a', 'b', 'c'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n2', set('n2', 'b'));
      const ofB = { column: 'label', equals: 'b' };

      expect([
        await keysOf(ledger, 'labels', { ...everyRow, where: [{ column: 'child_key', equals: 'b' }] }),
        await keysOf(ledger, 'labels', { ...everyRow, after: ['n1', 'a'] }),
        await keysOf(ledger, 'labels', { ...everyRow, order: 'desc', after: ['n2', 'b'] }),
        await keysOf(ledger, 'labels', { ...everyRow, orderBy: ['label'], where: [ofB], after: ['b', 'n1', 'b'] }),
        await Effect.runPromise(ledger.countProjectedRows('labels', alpha, [{ column: 'row_key', equals: 'n1' }])),
      ]).toEqual([
        [
          ['n1', 'b', 2],
          ['n2', 'b', 1],
        ],
        [
          ['n1', 'b', 2],
          ['n1', 'c', 3],
          ['n2', 'b', 1],
        ],
        [
          ['n1', 'c', 3],
          ['n1', 'b', 2],
          ['n1', 'a', 1],
        ],
        [['n2', 'b', 1]],
        3,
      ]);
    });
  });
}

function rowsOfSeveralStreamsUnderAKey(open: ChildRowsLedger): void {
  describe('a projection that keeps several rows under one key', () => {
    it('keeps the rows of a key its mapping names from facts of several streams, in the order they were appended', async () => {
      const ledger = await open([labelRowsByNote]);
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('shared', 'first'));
      await labelled(ledger, 'playbook/acme/alpha/others/o1', added('shared', 'second'));
      await labelled(ledger, 'playbook/acme/alpha/runs/r1', added('shared', 'never'));

      expect(await keysOf(ledger, 'note_labels')).toEqual([
        ['shared', 'first', 1],
        ['shared', 'second', 2],
      ]);
    });
  });
}

export function childRowsBehaviour(open: ChildRowsLedger): void {
  rowsKeptUnderAKey(open);
  rowsDroppedUnderAKey(open);
  rowsReadUnderAKey(open);
  rowsOfSeveralStreamsUnderAKey(open);
}
