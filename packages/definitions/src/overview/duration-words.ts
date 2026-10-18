import { listed } from '@on.auto/operations';

interface Unit {
  readonly per: number;
  readonly one: string;
  readonly other: string;
}

interface Counting {
  readonly rest: number;
  readonly parts: readonly string[];
}

const second: Unit = { per: 1000, one: 'second', other: 'seconds' };

const minute: Unit = { per: 60_000, one: 'minute', other: 'minutes' };

const units: readonly Unit[] = [
  { per: 86_400_000, one: 'day', other: 'days' },
  { per: 3_600_000, one: 'hour', other: 'hours' },
  minute,
  second,
];

const counted = new Intl.NumberFormat('en');

function partInWords(amount: number, { one, other }: Unit): string {
  return `${counted.format(amount)} ${amount === 1 ? one : other}`;
}

function withWholeUnits({ rest, parts }: Counting, unit: Unit): Counting {
  const amount = Math.floor(rest / unit.per);
  return amount === 0
    ? { rest, parts }
    : { rest: rest - amount * unit.per, parts: [...parts, partInWords(amount, unit)] };
}

export function durationInWords(milliseconds: number): string {
  const whole = Math.max(0, Math.round(milliseconds));
  if (whole < minute.per) {
    return partInWords(whole / second.per, second);
  }
  const start: Counting = { rest: Math.round(whole / second.per) * second.per, parts: [] };
  return listed(units.reduce((counting, unit) => withWholeUnits(counting, unit), start).parts);
}
