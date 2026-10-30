import { inWords } from '../plain-language/in-words.ts';
import { numberOf, type JsonSchema } from './schema-reading.ts';

interface Unit {
  readonly one: string;
  readonly other: string;
}

export interface Bound {
  readonly low: string;
  readonly high: string;
  readonly from: string;
  readonly unit?: Unit;
}

export interface Amount {
  readonly words: string;
  readonly last: number;
}

export const item: Unit = { one: 'item', other: 'items' };

export const entry: Unit = { one: 'entry', other: 'entries' };

const numberBound: Bound = { low: 'minimum', high: 'maximum', from: 'from ' };

const lengthBound: Bound = {
  low: 'minLength',
  high: 'maxLength',
  from: '',
  unit: { one: 'character', other: 'characters' },
};

export const itemBound: Bound = { low: 'minItems', high: 'maxItems', from: '', unit: item };

export const entryBound: Bound = { low: 'minProperties', high: 'maxProperties', from: '', unit: entry };

const counted = new Intl.NumberFormat('en');

function rangeWords(least: number, most: number, from: string): string {
  return least === most
    ? `exactly ${counted.format(most)}`
    : `${from}${counted.format(least)} to ${counted.format(most)}`;
}

export function amountOf(schema: JsonSchema, { low, high, from }: Bound): Amount | undefined {
  const least = numberOf(schema, low);
  const most = numberOf(schema, high);
  if (least !== undefined && most !== undefined) {
    return { words: rangeWords(least, most, from), last: most };
  }
  if (least !== undefined) {
    return { words: `at least ${counted.format(least)}`, last: least };
  }
  return most === undefined ? undefined : { words: `at most ${counted.format(most)}`, last: most };
}

export function countedIn({ words, last }: Amount, { one, other }: Unit): string {
  return `${words} ${last === 1 ? one : other}`;
}

function boundWords(schema: JsonSchema, bound: Bound): readonly string[] {
  const amount = amountOf(schema, bound);
  if (amount === undefined) {
    return [];
  }
  return [bound.unit === undefined ? amount.words : countedIn(amount, bound.unit)];
}

function exclusiveWords(schema: JsonSchema): readonly string[] {
  const above = numberOf(schema, 'exclusiveMinimum');
  const below = numberOf(schema, 'exclusiveMaximum');
  return [
    ...(above === undefined ? [] : [`more than ${counted.format(above)}`]),
    ...(below === undefined ? [] : [`less than ${counted.format(below)}`]),
  ];
}

function multipleWords(schema: JsonSchema): readonly string[] {
  const divisor = numberOf(schema, 'multipleOf');
  return divisor === undefined ? [] : [`a multiple of ${counted.format(divisor)}`];
}

function uniqueWords(schema: JsonSchema): readonly string[] {
  return schema['uniqueItems'] === true ? ['no item twice'] : [];
}

function defaultWords(schema: JsonSchema): readonly string[] {
  const value = schema['default'];
  return value === undefined ? [] : [`${inWords(value) ?? 'a default'} when left out`];
}

export function trailingWords(schema: JsonSchema, saidBefore: readonly Bound[]): readonly string[] {
  const trailing = [numberBound, lengthBound, itemBound, entryBound].filter((bound) => !saidBefore.includes(bound));
  return [
    ...trailing.flatMap((bound) => boundWords(schema, bound)),
    ...exclusiveWords(schema),
    ...multipleWords(schema),
    ...uniqueWords(schema),
    ...defaultWords(schema),
  ];
}
