import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { everyProjectedRow, rowsReadAtOnce } from './every-row.ts';
import type { ProjectedKeyedRow, ProjectedRowsQuery } from './keyed-projection.ts';

function rowsOf(count: number): readonly ProjectedKeyedRow[] {
  return Array.from({ length: count }, (_, at) => ({ org: 'acme', key: `k${at}`, row: { at } }));
}

function pagedOver(rows: readonly ProjectedKeyedRow[]) {
  const asked: ProjectedRowsQuery[] = [];
  const read = (query: ProjectedRowsQuery) =>
    Effect.sync(() => {
      asked.push(query);
      const after = String(query.after?.at(-1) ?? '');
      return rows.filter(({ key }) => key > after).slice(0, query.limit);
    });
  return { asked, read };
}

describe('every row of a projection, read a page at a time', () => {
  it.each([0, 1, 2, 3, 5])('answers all %i rows in their order, two at a time', async (count) => {
    const rows = rowsOf(count);
    const { read } = pagedOver(rows);

    expect(await Effect.runPromise(everyProjectedRow(read, ['at'], 2))).toEqual(rows);
  });

  it('goes on after the last row of a full page by its ordered columns and its key', async () => {
    const { asked, read } = pagedOver(rowsOf(3));

    await Effect.runPromise(everyProjectedRow(read, ['at'], 2));

    expect(asked).toEqual([
      { where: [], orderBy: ['at'], order: 'asc', limit: 2 },
      { where: [], orderBy: ['at'], order: 'asc', after: [1, 'k1'], limit: 2 },
    ]);
  });

  it('goes on after a row that holds none of an ordered column as after null', async () => {
    const { asked, read } = pagedOver(rowsOf(2));

    await Effect.runPromise(everyProjectedRow(read, ['missing'], 1));

    expect(asked[1]?.after).toEqual([null, 'k0']);
  });

  it('reads 100 rows at a time unless told otherwise', () => {
    expect(rowsReadAtOnce).toBe(100);
  });
});
