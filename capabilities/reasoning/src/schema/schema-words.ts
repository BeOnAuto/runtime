import { isFormatName, stringFormats, type FormatName } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { joined } from './schema-definitions.ts';

const boundWords: Readonly<Record<string, (bound: number) => string>> = {
  minLength: (bound) => `at least ${plural(bound, 'character', 'characters')} long`,
  maxLength: (bound) => `at most ${plural(bound, 'character', 'characters')} long`,
  minimum: (bound) => `at least ${bound}`,
  maximum: (bound) => `at most ${bound}`,
  exclusiveMinimum: (bound) => `more than ${bound}`,
  exclusiveMaximum: (bound) => `less than ${bound}`,
  multipleOf: (bound) => `a multiple of ${bound}`,
  minItems: (bound) => `at least ${plural(bound, 'item', 'items')}`,
  maxItems: (bound) => `at most ${plural(bound, 'item', 'items')}`,
  minProperties: (bound) => `an object of at least ${plural(bound, 'property', 'properties')}`,
  maxProperties: (bound) => `an object of at most ${plural(bound, 'property', 'properties')}`,
};

const formatWords: Readonly<Record<FormatName, string>> = {
  date: 'a date',
  'date-time': 'a date and time',
  time: 'a time',
  email: 'an email address',
  uri: 'an absolute URI',
  uuid: 'a UUID',
};

const entryCounts: Readonly<Record<string, string>> = { minProperties: 'at least', maxProperties: 'at most' };

const entryWords = 'Each entry is one key and its value, each key once.';

export const movedToWords: ReadonlySet<string> = new Set([...Object.keys(boundWords), 'uniqueItems', 'format']);

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function sentenceOf(text: Schema.Json | undefined): readonly string[] {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') {
    return [];
  }
  return [/[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`];
}

function rulesSentence(rules: readonly string[]): readonly string[] {
  return rules.length === 0 ? [] : [`Must be ${rules.join('; ')}.`];
}

function rulesOf(schema: Schema.JsonObject): readonly string[] {
  const bounds = Object.entries(boundWords).flatMap(
    ([keyword, words]: readonly [string, (bound: number) => string]) => {
      const bound = schema[keyword];
      return typeof bound === 'number' ? [words(bound)] : [];
    },
  );
  const format = schema['format'];
  return [
    ...bounds,
    ...(schema['uniqueItems'] === true ? ['without any item repeated'] : []),
    ...(isFormatName(format) ? [`${formatWords[format]} such as ${stringFormats[format].example}`] : []),
  ];
}

export function wordsOf(schema: Schema.JsonObject): string | undefined {
  const parts = [...sentenceOf(schema['description']), ...rulesSentence(rulesOf(schema))];
  return parts.length === 0 ? undefined : parts.join(' ');
}

export function withWords(lowered: Schema.JsonObject, words: string | undefined): Schema.JsonObject {
  if (words === undefined) {
    return lowered;
  }
  const existing = lowered['description'];
  return joined(lowered, { description: typeof existing === 'string' ? `${existing} ${words}` : words });
}

export function mapWordsOf(schema: Schema.JsonObject): string {
  const counts = Object.entries(entryCounts).flatMap(([keyword, words]: readonly [string, string]) => {
    const count = schema[keyword];
    return typeof count === 'number' ? [`${words} ${plural(count, 'entry', 'entries')}`] : [];
  });
  return [...sentenceOf(schema['description']), entryWords, ...rulesSentence(counts)].join(' ');
}
