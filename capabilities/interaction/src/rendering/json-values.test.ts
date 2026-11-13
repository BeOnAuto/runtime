import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonOf } from './json-values.ts';

describe('a value read as JSON', () => {
  it('is kept when it is plain JSON', () => {
    expect(jsonOf({ a: [1, 'b', null] }, 'The value')).toEqual(Result.succeed({ a: [1, 'b', null] }));
  });

  it('is refused by name when it holds something JSON cannot', () => {
    expect(jsonOf({ a: undefined }, 'The value')).toEqual(Result.fail(['The value is not plain JSON']));
  });
});
