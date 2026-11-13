import { Conflict } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { appendRefusedAs, conflictOfARefusal, refusedStreamOf } from './append-refused.ts';

const stream = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/definitions';

describe('a refusal of an append', () => {
  it('is known by its tag and its shape, of whatever copy of the package raised it, as the conflict it carries', () => {
    const taken = new Conflict({ detail: 'The name is taken', kind: 'taken' });
    const withoutAKind = new Conflict({ detail: 'The append is refused' });

    expect([
      conflictOfARefusal(appendRefusedAs(taken, stream)),
      conflictOfARefusal(appendRefusedAs(withoutAKind, stream)),
      conflictOfARefusal({ _tag: 'append_refused', detail: 'Refused across a boundary', kind: 'taken' }),
    ]).toEqual([taken, withoutAKind, new Conflict({ detail: 'Refused across a boundary', kind: 'taken' })]);
  });

  it('names the stream whose fact it refused, beside the conflict, which names no stream', () => {
    const taken = new Conflict({ detail: 'The name is taken', kind: 'taken' });

    expect([
      refusedStreamOf(appendRefusedAs(taken, stream)),
      refusedStreamOf({ _tag: 'append_refused', detail: 'Refused across a boundary', stream }),
      refusedStreamOf({ _tag: 'append_refused', detail: 'Refused without its stream', kind: 'taken' }),
    ]).toEqual([
      { stream, conflict: taken },
      { stream, conflict: new Conflict({ detail: 'Refused across a boundary' }) },
      undefined,
    ]);
  });

  it('is nothing else, such as a conflict itself, an error or a refusal of another shape', () => {
    expect([
      conflictOfARefusal(new Conflict({ detail: 'Not a refusal', kind: 'taken' })),
      conflictOfARefusal(new Error('append_refused')),
      conflictOfARefusal({ _tag: 'append_refused', kind: 'taken' }),
      conflictOfARefusal({ _tag: 'append_refused', detail: 'Of a kind no conflict has', kind: 'unheard_of' }),
      refusedStreamOf(new Conflict({ detail: 'Not a refusal', kind: 'taken' })),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
