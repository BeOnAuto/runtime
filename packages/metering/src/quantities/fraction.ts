export interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type Rounding = 'nearest' | 'up';

const decimal = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

export function decimalFraction(value: string): Fraction {
  if (value.length > 100 || !decimal.test(value)) {
    throw new RangeError('A cost must be a non-negative finite decimal');
  }
  const coefficient = value.replace(/[eE].*$/u, '');
  const dot = coefficient.indexOf('.');
  const decimalPlaces = dot < 0 ? 0 : coefficient.length - dot - 1;
  const scale = decimalPlaces - Number(value.slice(coefficient.length + 1));
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 36) {
    throw new RangeError('A cost may have at most 36 decimal places or exponent places');
  }
  const digits = BigInt(coefficient.replace('.', ''));
  return scale < 0
    ? { numerator: digits * 10n ** BigInt(-scale), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(scale) };
}

export function addedFractions(first: Fraction, second: Fraction): Fraction {
  let divisor = first.denominator;
  let remainder = second.denominator;
  while (remainder !== 0n) {
    const next = divisor % remainder;
    divisor = remainder;
    remainder = next;
  }
  const firstFactor = second.denominator / divisor;
  const secondFactor = first.denominator / divisor;
  return {
    numerator: first.numerator * firstFactor + second.numerator * secondFactor,
    denominator: first.denominator * firstFactor,
  };
}

export function multipliedFraction(value: Fraction, numerator: bigint, denominator = 1n): Fraction {
  return { numerator: value.numerator * numerator, denominator: value.denominator * denominator };
}

export function equalFractions(first: Fraction, second: Fraction): boolean {
  return first.numerator * second.denominator === second.numerator * first.denominator;
}

export function roundedFraction({ numerator, denominator }: Fraction, rounding: Rounding): bigint {
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (rounding === 'up') {
    return whole + (remainder === 0n ? 0n : 1n);
  }
  const comparison = 2n * remainder - denominator;
  return comparison > 0n || (comparison === 0n && whole % 2n !== 0n) ? whole + 1n : whole;
}
