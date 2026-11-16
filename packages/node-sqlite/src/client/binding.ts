import type { SQLInputValue } from 'node:sqlite';

import { DataError } from '@event-driven-io/dumbo';

const leastInteger32 = -0x80_00_00_00;

const mostInteger32 = 0x7f_ff_ff_ff;

function isAWholeNumberWithin32Bits(value: number): boolean {
  return Math.trunc(value) === value && value >= leastInteger32 && value <= mostInteger32;
}

function boundNumber(value: number): SQLInputValue {
  return isAWholeNumberWithin32Bits(value) ? BigInt(value) : value;
}

export function boundValueOf(value: unknown): SQLInputValue {
  if (typeof value === 'number') {
    return boundNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1n : 0n;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'bigint' || value instanceof Uint8Array) {
    return value;
  }
  throw new DataError(`Unsupported node:sqlite binding type: ${typeof value}`);
}

export function boundValuesOf(values: readonly unknown[]): readonly SQLInputValue[] {
  return values.map((value) => boundValueOf(value));
}
