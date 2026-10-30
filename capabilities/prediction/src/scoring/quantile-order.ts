import { rangeHolds } from '@on.auto/definitions';

import { percentiles } from './scoring-grid.ts';

export function answeredInOrder(q: Readonly<ArrayLike<number>>): boolean {
  return Array.from({ length: q.length / percentiles }, (_, step) => step * percentiles).every((place) =>
    rangeHolds({ low: Number(q[place]), value: Number(q[place + 1]), high: Number(q[place + 2]) }),
  );
}

export function answeredWhole(q: Readonly<ArrayLike<number>>): boolean {
  return Array.from(q).every((value) => Number.isFinite(value)) && answeredInOrder(q);
}
