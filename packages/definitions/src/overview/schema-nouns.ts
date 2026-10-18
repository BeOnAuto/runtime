import type { FormatName } from '@on.auto/json-schema';

import type { Amount } from './schema-bounds.ts';

export type Count = 'one' | 'other' | 'countedOne' | 'countedOther';

type Noun = Readonly<Record<Count, string>>;

export const text: Noun = { one: 'text', other: 'text', countedOne: 'text value', countedOther: 'text values' };

const wholeNumbers: Noun = {
  one: 'a whole number',
  other: 'whole numbers',
  countedOne: 'whole number',
  countedOther: 'whole numbers',
};

export const numbers: Noun = { one: 'a number', other: 'numbers', countedOne: 'number', countedOther: 'numbers' };

export const yesOrNo: Noun = {
  one: 'yes or no',
  other: 'yes-or-no values',
  countedOne: 'yes-or-no value',
  countedOther: 'yes-or-no values',
};

export const nothing: Noun = {
  one: 'nothing',
  other: 'empty values',
  countedOne: 'empty value',
  countedOther: 'empty values',
};

export const nouns: Readonly<Record<string, Noun>> = {
  integer: wholeNumbers,
  number: numbers,
  boolean: yesOrNo,
  null: nothing,
};

export const forms: Readonly<Record<FormatName, Noun>> = {
  date: { one: 'a date', other: 'dates', countedOne: 'date', countedOther: 'dates' },
  'date-time': {
    one: 'a date and time',
    other: 'dates and times',
    countedOne: 'date and time',
    countedOther: 'dates and times',
  },
  time: { one: 'a time', other: 'times', countedOne: 'time', countedOther: 'times' },
  email: {
    one: 'an email address',
    other: 'email addresses',
    countedOne: 'email address',
    countedOther: 'email addresses',
  },
  uri: { one: 'a URI', other: 'URIs', countedOne: 'URI', countedOther: 'URIs' },
  uuid: { one: 'a UUID', other: 'UUIDs', countedOne: 'UUID', countedOther: 'UUIDs' },
};

export const list: Noun = { one: 'a list', other: 'lists', countedOne: 'list', countedOther: 'lists' };

export const record: Noun = { one: 'a record', other: 'records', countedOne: 'record', countedOther: 'records' };

export const anyValue: Noun = { one: 'any value', other: 'any values', countedOne: 'value', countedOther: 'values' };

export const values: Noun = { one: 'a value', other: 'values', countedOne: 'value', countedOther: 'values' };

export const eachOf: Readonly<Record<Count, string>> = {
  one: '',
  other: 'values, each ',
  countedOne: 'value, ',
  countedOther: 'values, each ',
};

export function countOf(amount: Amount | undefined, uncounted: Count): Count {
  if (amount === undefined) {
    return uncounted;
  }
  return amount.last === 1 ? 'countedOne' : 'countedOther';
}
