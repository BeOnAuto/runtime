import { isFormatName } from '@on.auto/json-schema';
import { alternatives, asSentence } from '@on.auto/operations';
import type { Schema } from 'effect';

import { firstCharacters } from '../plain-language/characters.ts';
import { inWords } from '../plain-language/in-words.ts';
import { named, paragraph, type OverviewBlock, type Phrase, type Phrases } from './overview.ts';
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

type Words = readonly [string, ...Phrase[]];

const boundsWithin: Readonly<Record<string, Bound>> = { array: itemBound, object: entryBound };

export const mostFieldDescriptionCharacters = 300;

const mostNamedValues = 12;

const mostNamedFields = 12;

const mostAlternatives = 4;

function andMore(shown: readonly string[], total: number): string {
  return [...shown, ...(total > shown.length ? [`and ${total - shown.length} more`] : [])].join(', ');
}

function choiceWords(schema: JsonSchema, count: Count): Words | undefined {
  const choices = schema['enum'];
  const constant = schema['const'];
  if (isJsonList(choices)) {
    const listed = andMore(
      choices.slice(0, mostNamedValues).map((value) => valueText(value)),
      choices.length,
    );
    return [`${eachOf[count]}one of: ${listed}`];
  }
  return constant === undefined ? undefined : [`${eachOf[count]}exactly ${valueText(constant)}`];
}

function joined([first, ...rest]: readonly [Words, ...Words[]], separator: string): Words {
  return [first[0], ...first.slice(1), ...rest.flatMap((words) => [separator, ...words])];
}

function alternativeWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words | undefined {
  const anyOf = listOf(schema, 'anyOf');
  const members = (anyOf.length > 0 ? anyOf : listOf(schema, 'oneOf')).filter((member) => isJsonSchema(member));
  const [first, ...rest] = members.map((member) => wordsOf(member, deeper(reading), count));
  if (first === undefined) {
    return undefined;
  }
  if (members.length > mostAlternatives) {
    return [
      count === 'one' ? `one of ${members.length} kinds of value` : `${values[count]} of ${members.length} kinds`,
    ];
  }
  return joined([first, ...rest], ' or ');
}

export function descriptionOf(schema: JsonSchema): string | undefined {
  const description = textOf(schema, 'description')?.trim();
  if (description === undefined || description === '') {
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

function subFieldPhrases(name: string, property: JsonSchema, required: boolean, reading: SchemaReading): Phrases {
  const description = descriptionOf(resolvedSchema(property, reading).schema);
  return [
    named(name),
    ' (',
    ...(description === undefined ? [] : [`${description}; `]),
    ...wordsOf(property, reading, 'one'),
    required ? ')' : ', optional)',
  ];
}

function sizedRecord(schema: JsonSchema, count: Count): string {
  const amount = amountOf(schema, entryBound);
  return amount === undefined ? record[count] : `${record[count]} of ${countedIn(amount, entry)}`;
}

function entryWords(schema: JsonSchema, entries: JsonSchema, reading: SchemaReading, count: Count): Words {
  const [first, ...rest] = wordsOf(entries, deeper(reading), 'one');
  const lead =
    amountOf(schema, entryBound) === undefined
      ? `${record[count]} whose every entry is`
      : `${sizedRecord(schema, count)}, each`;
  return [`${lead} ${first}`, ...rest];
}

function recordWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const properties = propertiesOf(schema);
  const entries = schema['additionalProperties'];
  if (!reading.expanded && properties.length === 0 && isJsonSchema(entries)) {
    return entryWords(schema, entries, reading, count);
  }
  if (reading.expanded || properties.length === 0) {
    return [sizedRecord(schema, count)];
  }
  const required = requiredOf(schema);
  const fields = properties
    .slice(0, mostNamedFields)
    .map(([name, property]) => subFieldPhrases(name, property, required.has(name), deeper(reading, true)));
  const more = properties.length - fields.length;
  const listed: Phrase[] = [];
  for (const [index, field] of fields.entries()) {
    listed.push(...(index > 0 ? [', '] : []), ...field);
  }
  return [`${sizedRecord(schema, count)} with: `, ...listed, ...(more > 0 ? [`, and ${more} more`] : [])];
}

function listWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const items = schema['items'];
  const amount = amountOf(schema, itemBound);
  if (!isJsonSchema(items)) {
    return [amount === undefined ? list[count] : `${list[count]} of ${countedIn(amount, item)}`];
  }
  const [first, ...rest] = wordsOf(items, deeper(reading), countOf(amount, 'other'));
  const bounded = amount === undefined ? '' : `${amount.words} `;
  return [`${list[count]} of ${bounded}${first}`, ...rest];
}

function textWords(format: string | undefined, count: Count): string {
  if (isFormatName(format)) {
    return forms[format][count];
  }
  return format === undefined ? text[count] : `${text[count]} in the form the schema calls ${format}`;
}

function kindWords(kind: string, schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  switch (kind) {
    case 'array': {
      return listWords(schema, reading, count);
    }
    case 'object': {
      return recordWords(schema, reading, count);
    }
    case 'string': {
      return [textWords(textOf(schema, 'format'), count)];
    }
    default: {
      return [(nouns[kind] ?? anyValue)[count]];
    }
  }
}

function kindsOf(schema: JsonSchema): readonly [string, ...string[]] {
  const [first, ...rest] = typesOf(schema);
  if (first !== undefined) {
    return [first, ...rest];
  }
  if (isJsonSchema(schema['properties'])) {
    return ['object'];
  }
  return isJsonSchema(schema['items']) ? ['array'] : ['any'];
}

function kindsWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const [firstKind, ...otherKinds] = kindsOf(schema);
  return joined(
    [
      kindWords(firstKind, schema, reading, count),
      ...otherKinds.map((kind) => kindWords(kind, schema, reading, count)),
    ],
    ' or ',
  );
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

function wordsOf(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  if (reading.depth > mostSchemaDepth) {
    return [anyValue[count]];
  }
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  const choice = choiceWords(read, count);
  const alternative = choice === undefined ? alternativeWords(read, within, count) : undefined;
  const [first, ...rest] = choice ?? alternative ?? kindsWords(read, within, count);
  const separator = choice === undefined ? ', ' : '; ';
  const saidWithin = choice === undefined && alternative === undefined ? boundsSaidWithin(read) : [];
  const trailing = saidOfEach(trailingWords(read, saidWithin), count);
  return [first, ...rest, ...trailing.map((words) => `${separator}${words}`)];
}

function capitalizedWords([first, ...rest]: Words): Words {
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest];
}

function fieldWords(property: JsonSchema, reading: SchemaReading): Phrases {
  const read = resolvedSchema(property, reading).schema;
  const description = descriptionOf(read);
  return [
    ...(description === undefined ? [] : [`${asSentence(description)} `]),
    ...capitalizedWords(wordsOf(property, reading, 'one')),
    ...examplesWordsOf(listOf(read, 'examples'), description).map((words) => `, ${words}`),
    '.',
  ];
}

export function expectedWordsOf(schema: JsonSchema, root: JsonSchema): Phrases {
  return wordsOf(schema, { root, depth: 0, expanded: false }, 'one');
}

export function describedSchemaBlocks(schema: JsonSchema): readonly OverviewBlock[] {
  const reading: SchemaReading = { root: schema, depth: 0, expanded: false };
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  const description = descriptionOf(read);
  const opening = description === undefined ? [] : [paragraph(asSentence(description))];
  const properties = propertiesOf(read);
  if (properties.length === 0) {
    return [...opening, paragraph(...capitalizedWords(wordsOf(schema, reading, 'one')), '.')];
  }
  const required = requiredOf(read);
  const rows = properties.map(([name, property]) => ({
    name,
    required: required.has(name),
    words: fieldWords(property, deeper(within)),
  }));
  return [...opening, { kind: 'fields', rows }];
}

export function schemaBlocks(schema: JsonSchema | undefined, unknown: string): readonly OverviewBlock[] {
  return schema === undefined ? [paragraph(unknown)] : describedSchemaBlocks(schema);
}
