import { describe, expect, it } from 'vitest';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import { payloadReadsOf } from '../payload-testing/payload-reads.ts';
import type { ChildRowsProjection } from '../projections/keyed-projection.ts';
import { labelRows, labelledContext } from '../projections/label-rows.ts';
import { comparedColumnOf } from '../projections/projected-conditions.ts';
import { checkedProjection } from '../projections/projection-checks.ts';
import { runTallyRows } from '../projections/tally-rows.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { childRowsBehaviour } from './child-rows-behaviour.ts';

childRowsBehaviour((projections) => Promise.resolve(memoryLedger(undefined, projections).service));

describe('the declaration of a projection that keeps several rows under one key', () => {
  it('lets its reader advance none of its columns, since an advance names one row by its key alone', () => {
    const advancing: ChildRowsProjection = { ...labelRows, advanced: [{ column: 'place', setBy: ['labels_set'] }] };

    expect(() => checkedProjection(advancing)).toThrow(
      'The projection labels keeps several rows under a key, so its reader may advance none of its columns',
    );
    expect(checkedProjection(labelRows)).toBe(labelRows);
  });

  it('names its child key as a text a read may compare, which a projection of one row a key does not have', () => {
    expect(comparedColumnOf(labelRows, { column: 'child_key', after: 'a' })).toEqual({
      column: 'child_key',
      comparison: 'after',
      value: 'a',
    });
    expect(() => comparedColumnOf(runTallyRows, { column: 'child_key', equals: 'a' })).toThrow(
      'The projection run_tallies has no column child_key',
    );
  });
});

const labelsHeld: ContentHolders = new Map([
  ['labels_set', { payloads: [{ sha256: '/note_sha256', bytes: '/note_bytes' }] }],
]);

const setWithItsNote = { type: 'labels_set', data: { note: 'n1', labels: ['urgent'] }, context: labelledContext };

describe('the check that a projection of several rows under a key folds no payload a fact may keep outside', () => {
  it('finds a projection whose rows a payload kept outside would change, and none whose rows it would not', () => {
    const notedRows: ChildRowsProjection = {
      ...labelRows,
      name: 'noted_labels',
      rowsAfter: (rows, { data }) => new Map([...rows, ['note', { label: JSON.stringify(data) }]]),
    };
    const steadyRows: ChildRowsProjection = {
      ...labelRows,
      name: 'steady_labels',
      rowsAfter: (rows) => new Map([...rows, ['seen', { label: 'seen' }]]),
    };
    const quietRows: ChildRowsProjection = { ...labelRows, name: 'quiet_labels', rowsAfter: (): undefined => {} };

    expect(
      payloadReadsOf({ projections: [notedRows, steadyRows, quietRows] }, labelsHeld, [setWithItsNote, setWithItsNote]),
    ).toEqual([{ table: 'noted_labels_1', type: 'labels_set', payload: '/note', because: 'folded' }]);
  });
});
