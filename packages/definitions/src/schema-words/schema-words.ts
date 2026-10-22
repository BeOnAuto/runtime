import { isFormatName } from '@on.auto/json-schema';
import { alternatives } from '@on.auto/operations';
import type { Schema } from 'effect';

import { firstCharacters } from '../plain-language/characters.ts';
import { inWords } from '../plain-language/in-words.ts';
import { amountOf, countedIn, entry, entryBound, item, itemBound, trailingWords, type Bound } from './schema-bounds.ts';
import { anyValue, countOf, eachOf, forms, list, nouns, record, text, values, type Count } from './schema-nouns.ts';
import {
  deeper,
  isJsonList,
  isJsonSchema,
  listOf,
  mostSchemaDepth,
  propertiesOf,
  requiredOf,
  resolvedSchema,
  textOf,
  typesOf,
  valueText,
  type JsonSchema,
  type SchemaReading,
} from './schema-reading.ts';

const boundsWithin: Readonly<Record<string, Bound>> = { array: itemBound, object: entryBound };

const mostFieldDescriptionCharacters = 300;

const mostNamedValues = 12;

const mostNamedFields = 12;

const mostAlternatives = 4;

function andMore(shown: readonly string[], total: number): string {
  return [...shown, ...(total > shown.length ? [`and ${total - shown.length} more`] : [])].join(', ');
}

function choiceWords(schema: JsonSchema, count: Count): string | undefined {
  const choices = schema['enum'];
  const constant = schema['const'];
  if (isJsonList(choices)) {
    const listed = andMore(
      choices.slice(0, mostNamedValues).map((value) => valueText(value)),
      choices.length,
    );
    return `${eachOf[count]}one of: ${listed}`;
  }
  return constant === undefined ? undefined : `${eachOf[count]}exactly ${valueText(constant)}`;
}

function alternativeWords(schema: JsonSchema, reading: SchemaReading, count: Count): string | undefined {
  const anyOf = listOf(schema, 'anyOf');
  const members = (anyOf.length > 0 ? anyOf : listOf(schema, 'oneOf')).filter((member) => isJsonSchema(member));
  if (members.length === 0) {
    return undefined;
  }
  if (members.length > mostAlternatives) {
    return count === 'one' ? `one of ${members.length} kinds of value` : `${values[count]} of ${members.length} kinds`;
  }
  return members.map((member) => wordsOf(member, deeper(reading), count)).join(' or ');
}

function oneLine(written: string): string {
  const lines = written.split('\n');
  const last = lines.length - 1;
  return lines
    .map((line, index) => {
      const ended = index < last ? line.trimEnd() : line;
      return index > 0 ? ended.trimStart() : ended;
    })
    .filter((line, index) => index === 0 || index === last || line !== '')
    .join(' ');
}

export function descriptionOf(schema: JsonSchema): string | undefined {
  const written = textOf(schema, 'description');
  const description = written === undefined ? '' : oneLine(written).trim();
  if (description === '') {
    return undefined;
  }
  const shown = firstCharacters(description, mostFieldDescriptionCharacters);
  return shown === description ? description : `${shown}…`;
}

function shownInWords(example: Schema.Json): readonly string[] {
  const words = inWords(example);
  return words === undefined ? [] : [words];
}

const givesExamples = /\bsuch as\b/iu;

const wordCharacter = /[\p{L}\p{N}]/u;

function isWordCharacterAt(words: string, index: number): boolean {
  return wordCharacter.test(words.charAt(index));
}

function holdsAsAWord(words: string, word: string, from = 0): boolean {
  const at = words.indexOf(word, from);
  if (word === '' || at < 0) {
    return false;
  }
  const bounded = !isWordCharacterAt(words, at - 1) && !isWordCharacterAt(words, at + word.length);
  return bounded || holdsAsAWord(words, word, at + 1);
}

function saysAnExample(description: string, examples: Schema.JsonArray): boolean {
  return givesExamples.test(description) || examples.some((example) => holdsAsAWord(description, valueText(example)));
}

function isSaidIn(description: string | undefined, examples: Schema.JsonArray): boolean {
  return description !== undefined && saysAnExample(description, examples);
}

export function examplesWordsOf(examples: Schema.JsonArray, description: string | undefined): readonly string[] {
  const shown = examples.flatMap((example) => shownInWords(example));
  return isSaidIn(description, examples) || shown.length === 0 ? [] : [`such as ${alternatives(shown)}`];
}

export function givesAnExample(examples: Schema.JsonArray, description: string | undefined): boolean {
  return isSaidIn(description, examples) || examples.some((example) => shownInWords(example).length > 0);
}

function subFieldWords(name: string, property: JsonSchema, required: boolean, reading: SchemaReading): string {
  const description = descriptionOf(resolvedSchema(property, reading).schema);
  const described = description === undefined ? '' : `${description}; `;
  return `${name} (${described}${wordsOf(property, reading, 'one')}${required ? ')' : ', optional)'}`;
}

function sizedRecord(schema: JsonSchema, count: Count): string {
  const amount = amountOf(schema, entryBound);
  return amount === undefined ? record[count] : `${record[count]} of ${countedIn(amount, entry)}`;
}

function entryWords(schema: JsonSchema, entries: JsonSchema, reading: SchemaReading, count: Count): string {
  const lead =
    amountOf(schema, entryBound) === undefined
      ? `${record[count]} whose every entry is`
      : `${sizedRecord(schema, count)}, each`;
  return `${lead} ${wordsOf(entries, deeper(reading), 'one')}`;
}

function recordWords(schema: JsonSchema, reading: SchemaReading, count: Count): string {
  const properties = propertiesOf(schema);
  const entries = schema['additionalProperties'];
  if (!reading.expanded && properties.length === 0 && isJsonSchema(entries)) {
    return entryWords(schema, entries, reading, count);
  }
  if (reading.expanded || properties.length === 0) {
    return sizedRecord(schema, count);
  }
  const required = requiredOf(schema);
  const fields = properties
    .slice(0, mostNamedFields)
    .map(([name, property]) => subFieldWords(name, property, required.has(name), deeper(reading, true)));
  const more = properties.length - fields.length;
  return `${sizedRecord(schema, count)} with: ${fields.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

function listWords(schema: JsonSchema, reading: SchemaReading, count: Count): string {
  const items = schema['items'];
  const amount = amountOf(schema, itemBound);
  if (!isJsonSchema(items)) {
    return amount === undefined ? list[count] : `${list[count]} of ${countedIn(amount, item)}`;
  }
  const bounded = amount === undefined ? '' : `${amount.words} `;
  return `${list[count]} of ${bounded}${wordsOf(items, deeper(reading), countOf(amount, 'other'))}`;
}

function textWords(format: string | undefined, count: Count): string {
  if (isFormatName(format)) {
    return forms[format][count];
  }
  return format === undefined ? text[count] : `${text[count]} in the form the schema calls ${format}`;
}

function kindWords(kind: string, schema: JsonSchema, reading: SchemaReading, count: Count): string {
  switch (kind) {
    case 'array': {
      return listWords(schema, reading, count);
    }
    case 'object': {
      return recordWords(schema, reading, count);
    }
    case 'string': {
      return textWords(textOf(schema, 'format'), count);
    }
    default: {
      return (nouns[kind] ?? anyValue)[count];
    }
  }
}

function kindsOf(schema: JsonSchema): readonly string[] {
  const types = typesOf(schema);
  if (types.length > 0) {
    return types;
  }
  if (isJsonSchema(schema['properties'])) {
    return ['object'];
  }
  return isJsonSchema(schema['items']) ? ['array'] : ['any'];
}

function kindsWords(schema: JsonSchema, reading: SchemaReading, count: Count): string {
  return kindsOf(schema)
    .map((kind) => kindWords(kind, schema, reading, count))
    .join(' or ');
}

function boundsSaidWithin(schema: JsonSchema): readonly Bound[] {
  return kindsOf(schema).flatMap((kind) => {
    const bound = boundsWithin[kind];
    return bound === undefined ? [] : [bound];
  });
}

function saidOfEach(trailing: readonly string[], count: Count): readonly string[] {
  return count === 'one' ? trailing : trailing.map((words, index) => (index === 0 ? `each ${words}` : words));
}

function wordsOf(schema: JsonSchema, reading: SchemaReading, count: Count): string {
  if (reading.depth > mostSchemaDepth) {
    return anyValue[count];
  }
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  const choice = choiceWords(read, count);
  const alternative = choice === undefined ? alternativeWords(read, within, count) : undefined;
  const separator = choice === undefined ? ', ' : '; ';
  const saidWithin = choice === undefined && alternative === undefined ? boundsSaidWithin(read) : [];
  const trailing = saidOfEach(trailingWords(read, saidWithin), count);
  return [choice ?? alternative ?? kindsWords(read, within, count), ...trailing].join(separator);
}

export function expectedWordsOf(schema: JsonSchema, root: JsonSchema): string {
  return wordsOf(schema, { root, depth: 0, expanded: false }, 'one');
}
