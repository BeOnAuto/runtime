import { describe, expect, it } from 'vitest';

import { rowsNotOfTheGreatest } from './stream-checks.ts';
import type { GroupwiseMaximum } from './stream-projection.ts';

const latest: GroupwiseMaximum = {
  projection: 'notes',
  groups: 'sets',
  groupedBy: ['note'],
  greatest: 'at',
  matching: [{ column: 'last', equals: 'at' }],
};

describe('the rows of a table that must each be the greatest row of its group in another', () => {
  it('count those whose group has no row, or whose greatest row matches them on a column it names', () => {
    const groups = [
      { note: 'n1', at: 1 },
      { note: 'n1', at: 3 },
      { note: 'n1', at: 2 },
      { note: 'n2', at: 5 },
    ];

    expect([
      rowsNotOfTheGreatest(latest, [{ note: 'n1', last: 3 }], groups),
      rowsNotOfTheGreatest(latest, [{ note: 'n1', last: 2 }], groups),
      rowsNotOfTheGreatest(latest, [{ note: 'n3', last: 1 }], groups),
      rowsNotOfTheGreatest(latest, [{ last: 1 }], [{ at: 1 }]),
    ]).toEqual([0, 1, 1, 0]);
  });
});
