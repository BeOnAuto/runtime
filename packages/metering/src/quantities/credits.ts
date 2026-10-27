import { decimalFraction, multipliedFraction, roundedFraction, type Rounding } from './fraction.ts';

export const MICROCREDITS_PER_CREDIT = 1_000_000n;

export const MOST_CREDIT_UNITS = 9_007_199_254_740_991n;

export function checkedCreditUnits(units: bigint): bigint {
  if (units < 0n || units > MOST_CREDIT_UNITS) {
    throw new RangeError('Credit units must be non-negative and within the safe accounting range');
  }
  return units;
}

export function creditUnits(value: string): bigint {
  const fraction = multipliedFraction(decimalFraction(value), MICROCREDITS_PER_CREDIT);
  if (fraction.numerator % fraction.denominator !== 0n) {
    throw new RangeError('A credit quantity must be an exact number of microcredits');
  }
  return checkedCreditUnits(fraction.numerator / fraction.denominator);
}

export function creditUnitsFromDecimal(value: string, rounding: Rounding): bigint {
  return checkedCreditUnits(
    roundedFraction(multipliedFraction(decimalFraction(value), MICROCREDITS_PER_CREDIT), rounding),
  );
}

export function creditUnitsFromWire(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) {
    throw new RangeError('Wire credit units must be a canonical non-negative integer');
  }
  return checkedCreditUnits(BigInt(value));
}

export function creditUnitsForStorage(value: bigint): number {
  return Number(checkedCreditUnits(value));
}

export function creditsShown(units: bigint): string {
  const checked = checkedCreditUnits(units);
  const whole = checked / MICROCREDITS_PER_CREDIT;
  const fraction = String(checked % MICROCREDITS_PER_CREDIT)
    .padStart(6, '0')
    .replace(/0+$/u, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}
