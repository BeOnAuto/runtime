import { describe, expect, it } from 'vitest';

import { errorType, settlementOf, unworkableOutputOf } from './raised-error.ts';

describe('the rejection of an output that cannot work as its workflow is written', () => {
  it('settles as a conflict of the kind unworkable, in the words of the error at the root', () => {
    expect(
      settlementOf({ kind: 'raised', error: unworkableOutputOf('The output does not match its shape', '/') }),
    ).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: 'The output does not match its shape.',
    });
  });

  it('is of the problem type of a conflict alone, so an unworkable error of another type settles by its status', () => {
    const unworkable = unworkableOutputOf('Mismatched', '/');

    expect(settlementOf({ kind: 'raised', error: { ...unworkable, type: errorType('runtime') } })).toMatchObject({
      reason: 'invalid_input',
    });
    expect(settlementOf({ kind: 'raised', error: { ...unworkable, kind: 'stalled' } })).toMatchObject({
      reason: 'invalid_input',
    });
  });
});
