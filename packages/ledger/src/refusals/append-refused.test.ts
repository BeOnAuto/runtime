import { Conflict } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { appendRefusedAs, conflictOfARefusal } from './append-refused.ts';

describe('a refusal of an append', () => {
  it('is known by its tag and its shape, of whatever copy of the package raised it, as the conflict it carries', () => {
    const taken = new Conflict({ detail: 'The name is taken', kind: 'taken' });
    const withoutAKind = new Conflict({ detail: 'The append is refused' });

    expect([
      conflictOfARefusal(appendRefusedAs(taken)),
      conflictOfARefusal(appendRefusedAs(withoutAKind)),
      conflictOfARefusal({ _tag: 'append_refused', detail: 'Refused across a boundary', kind: 'taken' }),
    ]).toEqual([taken, withoutAKind, new Conflict({ detail: 'Refused across a boundary', kind: 'taken' })]);
  });

  it('is nothing else, such as a conflict itself, an error or a refusal of another shape', () => {
    expect([
      conflictOfARefusal(new Conflict({ detail: 'Not a refusal', kind: 'taken' })),
      conflictOfARefusal(new Error('append_refused')),
      conflictOfARefusal({ _tag: 'append_refused', kind: 'taken' }),
      conflictOfARefusal({ _tag: 'append_refused', detail: 'Of a kind no conflict has', kind: 'unheard_of' }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
