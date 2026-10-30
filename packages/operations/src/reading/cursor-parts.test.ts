import { Buffer } from 'node:buffer';

import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { cursorOfParts, cursorWithin, insideOf, partsOfCursor } from './cursor-parts.ts';

const record = cursorOfParts(['playbook/acme/alpha/', '42']);

describe('a cursor', () => {
  it('is the base64url encoding of a JSON array of its parts', () => {
    expect(record).toBe(Buffer.from(JSON.stringify(['playbook/acme/alpha/', '42'])).toString('base64url'));
    expect(partsOfCursor(record)).toEqual(Option.some(['playbook/acme/alpha/', '42']));
    expect(partsOfCursor('not a cursor')).toEqual(Option.none());
  });

  it('points inside a record with one more part, the index of the last event of the record answered', () => {
    const inside = cursorWithin(record, 3);

    expect(partsOfCursor(inside)).toEqual(Option.some(['playbook/acme/alpha/', '42', 3]));
    expect(insideOf(inside)).toEqual({ record, index: 3 });
  });

  it('points inside no record when it is a record of its own, none at all, or no cursor', () => {
    expect([insideOf(record), insideOf(), insideOf('not a cursor')]).toEqual([undefined, undefined, undefined]);
    expect(cursorWithin('not a cursor', 3)).toBe('not a cursor');
  });
});
