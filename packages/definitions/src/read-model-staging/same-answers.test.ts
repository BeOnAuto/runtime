import { NotFound } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { differingFieldsOf, sameAnswer } from './same-answers.ts';

describe('two answers compared as JSON compares them', () => {
  it('are the same whatever the order of their fields, and a field left undefined is a field left out', () => {
    expect([
      sameAnswer(
        { name: 'plain', version: 2, nested: { a: 1, b: [1, 2] } },
        { nested: { b: [1, 2], a: 1 }, version: 2, name: 'plain' },
      ),
      sameAnswer({ name: 'plain', reason: undefined }, { name: 'plain' }),
      sameAnswer([1, 2], [2, 1]),
      sameAnswer([1], [1, 1]),
      sameAnswer({ name: 'plain' }, { name: 'plain', reason: 'checked' }),
      sameAnswer({ name: 'plain' }, ['plain']),
      sameAnswer(Number.NaN, Number.NaN),
      sameAnswer(null, {}),
    ]).toEqual([true, true, false, false, false, false, true, false]);
  });

  it('name the fields that differ, in order, and an answer that is no object as its value', () => {
    expect([
      differingFieldsOf(
        { version: 2, status: 'active', name: 'plain' },
        { version: 3, name: 'plain', reason: 'checked' },
      ),
      differingFieldsOf([1], [2]),
      differingFieldsOf('plain', 'plain'),
      differingFieldsOf(undefined, { name: 'plain' }),
    ]).toEqual([['reason', 'status', 'version'], ['value'], [], ['value']]);
  });

  it('compare failures by their own fields, their kind among them', () => {
    expect(
      differingFieldsOf(
        new NotFound({ detail: 'There is no probe plain' }),
        new NotFound({ detail: 'There is no version 2 of the probe plain' }),
      ),
    ).toEqual(['detail']);
  });
});
