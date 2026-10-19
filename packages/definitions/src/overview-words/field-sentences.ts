import { isFormatName } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { listedPhrases, type Phrases } from '../overview/overview.ts';
import { anyValue, forms, list, nouns, record, text, type Count } from '../overview/schema-nouns.ts';
import {
  deeper,
  isJsonList,
  isJsonSchema,
  mostSchemaDepth,
  propertiesOf,
  requiredOf,
  resolvedSchema,
  textOf,
  valueText,
  type JsonSchema,
  type SchemaReading,
} from '../overview/schema-reading.ts';
import { kindsOf } from '../overview/schema-words.ts';
import type { OutputShape } from '../shapes/output-shape.ts';
import { shapeNouns } from '../shapes/shape-words.ts';
import { fieldMeaning, meaningOfDescription, type Listing } from './field-meanings.ts';

type Telling = 'given' | 'answered';

type Counted = Extract<Count, 'one' | 'countedOther'>;

function textKind(format: string | undefined, count: Counted): string {
  return isFormatName(format) ? forms[format][count] : text[count];
}

function kindWords(kind: string, schema: JsonSchema, reading: SchemaReading, count: Counted): string {
  const items = schema['items'];
  switch (kind) {
    case 'array': {
      return isJsonSchema(items)
        ? `${list[count]} of ${valueWords(items, deeper(reading), 'countedOther')}`
        : list[count];
    }
    case 'object': {
      return record[count];
    }
    case 'string': {
      return textKind(textOf(schema, 'format'), count);
    }
    default: {
      return (nouns[kind] ?? anyValue)[count];
    }
  }
}

function valueWords(schema: JsonSchema, reading: SchemaReading, count: Counted): string {
  if (reading.depth > mostSchemaDepth) {
    return anyValue[count];
  }
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  return kindsOf(read)
    .map((kind) => kindWords(kind, read, within, count))
    .join(' or ');
}

function kindInWords(schema?: JsonSchema): string {
  return schema === undefined ? anyValue.one : valueWords(schema, { root: schema, depth: 0, expanded: false }, 'one');
}

interface ToldField {
  readonly name: string;
  readonly schema: JsonSchema;
  readonly required: boolean;
}

export const mostToldFields = 8;

const mostEnumerated = 12;

function topOf(schema: JsonSchema): JsonSchema {
  return resolvedSchema(schema, { root: schema, depth: 0, expanded: false }).schema;
}

function fieldsOf(schema: JsonSchema): readonly ToldField[] {
  const read = topOf(schema);
  const required = requiredOf(read);
  return propertiesOf(read).map(([name, property]) => ({
    name,
    schema: resolvedSchema(property, { root: schema, depth: 1, expanded: false }).schema,
    required: required.has(name),
  }));
}

export function enumerationWords(choices: Schema.JsonArray): Phrases {
  const shown = choices.slice(0, mostEnumerated).map((value) => [valueText(value)]);
  const more = choices.length - shown.length;
  return [
    'one of ',
    ...listedPhrases(more > 0 ? [...shown, [`${more} more`]] : shown, 'and', 'serial-when-items-hold-commas'),
  ];
}

function choicesOf(schema: JsonSchema): Schema.JsonArray | undefined {
  const choices = schema['enum'];
  return isJsonList(choices) ? choices : undefined;
}

function fieldWords({ name, schema, required }: ToldField, listing: Listing, telling: Telling): Phrases {
  const choices = choicesOf(schema);
  return [
    fieldMeaning(name, textOf(schema, 'description'), listing),
    ...(choices === undefined ? [] : [', ', ...enumerationWords(choices)]),
    ...(telling === 'answered' && !required ? [', when there is one'] : []),
    ...(schema['default'] === undefined ? [] : [', else its default']),
  ];
}

function restOf(told: readonly ToldField[], all: readonly ToldField[]): readonly Phrases[] {
  if (told.length === all.length) {
    return [];
  }
  return [[told.length === 0 ? 'what Details lists' : 'the rest, under Details']];
}

function fieldsInWords(fields: readonly ToldField[], telling: Telling): Phrases {
  const listing: Listing = fields.length > 1 ? 'among-others' : 'alone';
  const told =
    fields.length > mostToldFields ? fields.filter(({ required }) => required).slice(0, mostToldFields) : fields;
  return listedPhrases(
    [...told.map((field) => fieldWords(field, listing, telling)), ...restOf(told, fields)],
    'and',
    'serial-when-items-hold-commas',
  );
}

export function givenWords(schema?: JsonSchema): Phrases {
  const fields = schema === undefined ? [] : fieldsOf(schema);
  if (fields.length > 0) {
    return fieldsInWords(fields, 'given');
  }
  const described = schema === undefined ? undefined : textOf(topOf(schema), 'description');
  return [(described === undefined ? undefined : meaningOfDescription(described, 'alone')) ?? 'any input'];
}

export function givenClause(schema?: JsonSchema): Phrases {
  return ['It is given ', ...givenWords(schema)];
}

export function answeredWords(schema?: JsonSchema, shape?: OutputShape): Phrases {
  if (shape !== undefined) {
    return [shapeNouns[shape.name]];
  }
  const fields = schema === undefined ? [] : fieldsOf(schema);
  if (fields.length > 0) {
    return fieldsInWords(fields, 'answered');
  }
  const choices = schema === undefined ? undefined : choicesOf(topOf(schema));
  return choices === undefined ? [kindInWords(schema)] : enumerationWords(choices);
}
