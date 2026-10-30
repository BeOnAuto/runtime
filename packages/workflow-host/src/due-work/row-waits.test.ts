import { describe, expect, it } from 'vitest';

import { rowWaitBounds, rowWaits } from './row-waits.ts';

describe('the waits of rows that could not be performed', () => {
  it('hold a row for a second, then twice as long each time, up to five minutes, and let it go once performed', () => {
    const waits = rowWaits();
    const untils: number[] = [];
    for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => step * 1_000_000)) {
      waits.failed('row', at);
      untils.push(waits.nextUntil(at) - at);
    }

    expect(untils).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]);
    expect([waits.holds('row', 10_000_000), waits.heldAt(10_000_000)]).toEqual([true, 1]);
    waits.performed('row');
    expect([waits.holds('row', 10_000_000), waits.heldAt(10_000_000), waits.nextUntil(0)]).toEqual([
      false,
      0,
      Number.POSITIVE_INFINITY,
    ]);
  });

  it('keep at most 4,096 rows, letting the one that failed first go', () => {
    const waits = rowWaits();
    for (const index of Array.from({ length: rowWaitBounds.keptRows + 1 }, (_, each) => each)) {
      waits.failed(`row-${index}`, 0);
    }

    expect([waits.heldAt(0), waits.holds('row-0', 0), waits.holds('row-1', 0)]).toEqual([
      rowWaitBounds.keptRows,
      false,
      true,
    ]);
  });
});
