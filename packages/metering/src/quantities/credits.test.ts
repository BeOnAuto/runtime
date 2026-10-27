import { describe, expect, it } from 'vitest';

import {
  checkedCreditUnits,
  creditUnits,
  creditUnitsForStorage,
  creditUnitsFromDecimal,
  creditUnitsFromWire,
  creditsShown,
  MICROCREDITS_PER_CREDIT,
  MOST_CREDIT_UNITS,
} from '../index.ts';

describe('credit quantities', () => {
  it.each([
    { value: '0', units: 0n, shown: '0' },
    { value: '1', units: 1_000_000n, shown: '1' },
    { value: '001.2500', units: 1_250_000n, shown: '1.25' },
    { value: '0.000001', units: 1n, shown: '0.000001' },
    { value: '1e-6', units: 1n, shown: '0.000001' },
    { value: '12.5E+2', units: 1_250_000_000n, shown: '1250' },
    { value: '100000000', units: 100_000_000_000_000n, shown: '100000000' },
    { value: '9007199254.740991', units: MOST_CREDIT_UNITS, shown: '9007199254.740991' },
  ])(
    'preserves $value credits exactly through storage and transport',
    ({ value, units, shown }: Readonly<{ value: string; units: bigint; shown: string }>) => {
      expect(creditUnits(value)).toBe(units);
      expect(creditsShown(units)).toBe(shown);
      expect(creditUnitsFromWire(String(units))).toBe(units);
      expect(BigInt(creditUnitsForStorage(units))).toBe(units);
    },
  );

  it('keeps the scale fixed independently of a plan or tariff', () => {
    expect(MICROCREDITS_PER_CREDIT).toBe(1_000_000n);
  });
});

describe('invalid credit quantities', () => {
  it.each(['', '-1', '+1', '.1', '1.', ' 1', '1 ', 'NaN', 'Infinity', '1/3', '1e', '1e1e1', '0x10', '9'.repeat(101)])(
    'refuses a malformed or unbounded decimal %s',
    (value) => {
      expect(() => creditUnits(value)).toThrow('non-negative finite decimal');
    },
  );

  it.each(['1e37', '1e-37', '1e999999999999999999999999999999999999999999999999999999999999999999'])(
    'refuses a decimal exponent outside the accounting bounds: %s',
    (value) => {
      expect(() => creditUnits(value)).toThrow('36 decimal places');
    },
  );

  it('refuses a grant finer than one microcredit instead of silently rounding it', () => {
    expect(() => creditUnits('0.0000001')).toThrow('exact number of microcredits');
  });

  it.each([-1n, MOST_CREDIT_UNITS + 1n])('refuses unsafe units %s at every storage boundary', (units) => {
    expect(() => checkedCreditUnits(units)).toThrow('safe accounting range');
    expect(() => creditUnitsForStorage(units)).toThrow('safe accounting range');
    expect(() => creditsShown(units)).toThrow('safe accounting range');
  });

  it('refuses decimal and wire values above the lossless storage range', () => {
    expect(() => creditUnits('9007199254.740992')).toThrow('safe accounting range');
    expect(() => creditUnitsFromWire('9007199254740992')).toThrow('safe accounting range');
  });

  it.each(['-1', '+1', '01', '1.0', '1e6', ' 1', '', '12345678901234567'])(
    'refuses noncanonical wire units %s',
    (value) => {
      expect(() => creditUnitsFromWire(value)).toThrow('canonical non-negative integer');
    },
  );
});

describe('credit rounding', () => {
  it.each([
    { value: '0.0000001', nearest: 0n, upper: 1n },
    { value: '0.0000005', nearest: 0n, upper: 1n },
    { value: '0.0000015', nearest: 2n, upper: 2n },
    { value: '0.0000025', nearest: 2n, upper: 3n },
    { value: '0.0000026', nearest: 3n, upper: 3n },
    { value: '1', nearest: 1_000_000n, upper: 1_000_000n },
  ])(
    'rounds settlement and reservation quantities for $value',
    ({ value, nearest, upper }: Readonly<{ value: string; nearest: bigint; upper: bigint }>) => {
      expect(creditUnitsFromDecimal(value, 'nearest')).toBe(nearest);
      expect(creditUnitsFromDecimal(value, 'up')).toBe(upper);
    },
  );
});
