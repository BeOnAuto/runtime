import { asSentence, listed, quoted } from '@on.auto/operations';
import { Predicate, type Schema } from 'effect';

import { charactersIn } from './characters.ts';

const mostValueInWordsCharacters = 300;

const wordBoundary = /(?<lower>[a-z0-9])(?<upper>[A-Z])/gu;

const separators = /[_-]+/gu;

export function nameInWords(name: string): string {
  return name.replaceAll(wordBoundary, '$<lower> $<upper>').replaceAll(separators, ' ').trim().toLowerCase();
}

function renderedArray(items: readonly Schema.Json[]): string {
  return items.length === 0 ? 'an empty list' : listed(items.map((item) => nested(item)));
}

function renderedObject(fields: Readonly<Record<string, Schema.Json>>): string {
  const entries = Object.entries(fields);
  return entries.length === 0
    ? 'nothing'
    : listed(entries.map(([name, value]: readonly [string, Schema.Json]) => `${nameInWords(name)}: ${nested(value)}`));
}

function isList(value: Schema.JsonArray | Schema.JsonObject): value is Schema.JsonArray {
  return Array.isArray(value);
}

function nested(value: Schema.Json): string {
  return Predicate.isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0
    ? `(${rendered(value)})`
    : rendered(value);
}

function rendered(value: Schema.Json): string {
  if (value === null) {
    return 'nothing';
  }
  if (typeof value === 'string') {
    return quoted(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return isList(value) ? renderedArray(value) : renderedObject(value);
}

export function inWords(value: Schema.Json): string | undefined {
  const words = rendered(value);
  return words.length <= 2 * mostValueInWordsCharacters && charactersIn(words) <= mostValueInWordsCharacters
    ? words
    : undefined;
}

type OutputNoun = 'answer' | 'result';

export function outputInWords(noun: OutputNoun): (output: Schema.Json) => string {
  return (output) => {
    const words = inWords(output);
    return words === undefined
      ? `Its ${noun} is too long to repeat here; the whole of it is in the details below.`
      : asSentence(`Its ${noun}: ${words}`);
  };
}
