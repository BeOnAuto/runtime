import { describe, expect, it } from 'vitest';

import { comparePoints, earliestOf, isAfter, pointIn, pointText } from './history-points.ts';

const nothingRead = pointIn('');

describe('a point in the history of a playbook', () => {
  it('is kept as text, and read back as it was written, or as before anything when it cannot be read', () => {
    expect([pointText(['12', '3']), pointText(nothingRead)]).toEqual(['["12","3"]', '']);
    expect([pointIn('["12","3"]'), pointIn(''), pointIn('[3]'), pointIn('not json')]).toEqual([
      ['12', '3'],
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('orders by each part as a whole number, however long, a missing part counting as zero', () => {
    expect([
      comparePoints(['9'], ['10']),
      comparePoints(['18446744073709551617'], ['18446744073709551616']),
      comparePoints(['4', '0'], ['4']),
      comparePoints(['4', '1'], ['4']),
      comparePoints(nothingRead, ['1']),
      comparePoints(nothingRead, nothingRead),
    ]).toEqual([-1, 1, 0, 1, -1, 0]);
    expect([isAfter(['2'], ['1']), isAfter(['1'], ['1']), isAfter(['1'], nothingRead)]).toEqual([true, false, true]);
  });

  it('finds the earliest of several, before anything when one has read nothing yet', () => {
    expect([earliestOf([['5'], ['3'], ['4']]), earliestOf([['5'], nothingRead, ['4']]), earliestOf([])]).toEqual([
      ['3'],
      undefined,
      undefined,
    ]);
  });
});
