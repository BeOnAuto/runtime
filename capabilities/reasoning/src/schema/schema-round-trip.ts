import { isFormatName, stringFormats, type SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import { choiceFits, readBack, type Fits } from './answer-reading.ts';
import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import {
  choicesOf,
  definedIn,
  definitionsOf,
  entriesOf,
  enumValuesOf,
  isJsonList,
  isJsonObject,
  isMap,
  isObjectRoot,
  joined,
  stringsOf,
  typesOf,
  type Definitions,
} from './schema-definitions.ts';

interface Witnessing {
  readonly definitions: Definitions;
  readonly everyOptional: boolean;
}

interface Writing {
  readonly definitions: Definitions;
  readonly fits: Fits;
}

type Witness = (schema: Schema.JsonObject, witnessing: Witnessing, depth: number) => Schema.Json;

const mostWitnessDepth = 12;

const noWitness = 'no answer this schema accepts could be made to test its portable form with';

const notKept =
  'an answer this schema accepts does not keep its meaning when written in the portable form and read back';

function numberOr(value: Schema.Json | undefined, otherwise: number): number {
  return typeof value === 'number' ? value : otherwise;
}

function countOf(schema: Schema.JsonObject, least: string, most: string): number {
  return Math.min(Math.max(numberOr(schema[least], 1), 1), numberOr(schema[most], Number.POSITIVE_INFINITY));
}

const listWitness: Witness = (schema, witnessing, depth) =>
  Array.from({ length: countOf(schema, 'minItems', 'maxItems') }, () =>
    witnessAt(schema['items'], witnessing, depth + 1),
  );

const textWitness: Witness = (schema) => {
  const format = schema['format'];
  return isFormatName(format) ? stringFormats[format].example : 'x'.repeat(countOf(schema, 'minLength', 'maxLength'));
};

function boundedNumber(schema: Schema.JsonObject, step: number): number {
  const low = numberOr(schema['minimum'], numberOr(schema['exclusiveMinimum'], Number.NEGATIVE_INFINITY));
  const high = numberOr(schema['maximum'], numberOr(schema['exclusiveMaximum'], Number.POSITIVE_INFINITY));
  const middle = Number.isFinite(low + high) ? (low + high) / 2 : Math.min(Math.max(0, low + 1), high - 1);
  return step === 0 ? middle : Math.ceil(middle / step) * step;
}

const numberWitness: Witness = (schema) => boundedNumber(schema, numberOr(schema['multipleOf'], 0));

const integerWitness: Witness = (schema) => boundedNumber(schema, numberOr(schema['multipleOf'], 1));

const witnessByKind = {
  array: listWitness,
  string: textWitness,
  number: numberWitness,
  integer: integerWitness,
  boolean: () => false,
} satisfies Readonly<Record<string, Witness>>;

function isWitnessKind(kind: string): kind is keyof typeof witnessByKind {
  return Object.hasOwn(witnessByKind, kind);
}

const objectWitness: Witness = (schema, witnessing, depth) => {
  const properties = entriesOf(schema['properties']);
  const required = new Set(stringsOf(schema['required']));
  const made = properties
    .filter(([name]) => witnessing.everyOptional || required.has(name))
    .map(([name, property]): readonly [string, Schema.Json] => [name, witnessAt(property, witnessing, depth + 1)]);
  const missing = [...required]
    .filter((name) => !properties.some(([property]) => property === name))
    .map((name): readonly [string, Schema.Json] => [name, 'x']);
  return Object.fromEntries([...made, ...missing]);
};

function keyWitness(rules: Schema.Json | undefined, index: number): string {
  const format = isJsonObject(rules) ? rules['format'] : undefined;
  return isFormatName(format) ? stringFormats[format].example : `k${index}`;
}

const mapWitness: Witness = (schema, witnessing, depth) => {
  const rules = schema['propertyNames'];
  const names = stringsOf(isJsonObject(rules) ? enumValuesOf(rules) : undefined);
  const value = witnessAt(schema['additionalProperties'], witnessing, depth + 1);
  const count = Math.max(numberOr(schema['minProperties'], 1), 1);
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [names[index] ?? keyWitness(rules, index), value]),
  );
};

function witnessOfKind(schema: Schema.JsonObject, witnessing: Witnessing, depth: number): Schema.Json {
  if (isMap(schema)) {
    return mapWitness(schema, witnessing, depth);
  }
  const types = typesOf(schema);
  if (types.includes('object') || schema['properties'] !== undefined) {
    return objectWitness(schema, witnessing, depth);
  }
  const kind = types.find((type) => isWitnessKind(type));
  return kind === undefined ? null : witnessByKind[kind](schema, witnessing, depth);
}

function withFirstChoice(schema: Schema.JsonObject, choice: Schema.Json): Schema.JsonObject {
  const shared = Object.fromEntries(
    Object.entries(schema).filter(
      ([keyword]: readonly [string, Schema.Json]) => keyword !== 'anyOf' && keyword !== 'oneOf',
    ),
  );
  return joined(shared, isJsonObject(choice) ? choice : {});
}

function witnessAt(node: Schema.Json | undefined, witnessing: Witnessing, depth: number): Schema.Json {
  const schema = definedIn(witnessing.definitions, node);
  if (depth > mostWitnessDepth || !isJsonObject(schema)) {
    return null;
  }
  const [value] = enumValuesOf(schema) ?? [];
  if (value !== undefined) {
    return value;
  }
  const [choice] = choicesOf(schema);
  return choice === undefined
    ? witnessOfKind(schema, witnessing, depth)
    : witnessAt(withFirstChoice(schema, choice), witnessing, depth + 1);
}

export function witnessOf(root: Schema.JsonObject, everyOptional: boolean): Schema.Json {
  return witnessAt(root, { definitions: definitionsOf(root), everyOptional }, 0);
}

function writtenObject(properties: Schema.JsonObject, value: Schema.JsonObject, writing: Writing): Schema.JsonObject {
  return Object.fromEntries(
    Object.entries(properties).map(
      ([name, property]: readonly [string, Schema.Json]): readonly [string, Schema.Json] => {
        const given = Object.hasOwn(value, name) ? value[name] : undefined;
        return [name, given === undefined ? null : writtenAt(property, given, writing)];
      },
    ),
  );
}

function writtenAt(node: Schema.Json | undefined, value: Schema.Json, writing: Writing): Schema.Json {
  const schema = definedIn(writing.definitions, node);
  if (!isJsonObject(schema)) {
    return value;
  }
  const choices = choicesOf(schema);
  if (choices.length > 0) {
    return writtenAt(
      choices.find((choice) => writing.fits(choice, value)),
      value,
      writing,
    );
  }
  const properties = schema['properties'];
  if (isJsonObject(value) && isMap(schema)) {
    return Object.entries(value).map(([key, entry]: readonly [string, Schema.Json]) => ({
      key,
      value: writtenAt(schema['additionalProperties'], entry, writing),
    }));
  }
  if (isJsonObject(value) && isJsonObject(properties)) {
    return writtenObject(properties, value, writing);
  }
  return isJsonList(value) ? value.map((item) => writtenAt(schema['items'], item, writing)) : value;
}

export function writtenFormOf(root: Schema.JsonObject, value: Schema.Json): Schema.Json {
  const written = writtenAt(root, value, { definitions: definitionsOf(root), fits: choiceFits(root) });
  return isObjectRoot(root) ? written : { value: written };
}

interface Checks {
  readonly author: AnswerSchema;
  readonly portable: AnswerSchema;
}

function accepts(schema: AnswerSchema, value: unknown): boolean {
  return Result.isSuccess(schema.validate(value));
}

function tripIssues({ author, portable }: Checks, everyOptional: boolean): readonly SchemaIssue[] {
  const witness = witnessOf(author.document, everyOptional);
  if (!accepts(author, witness)) {
    return [{ pointer: '', detail: noWitness }];
  }
  const written = writtenFormOf(author.document, witness);
  const read = readBack(author.document, written);
  const holds = accepts(portable, written) && read.issues.length === 0 && accepts(author, read.value);
  return holds ? [] : [{ pointer: '', detail: notKept }];
}

export function roundTripIssues(author: AnswerSchema, sent: Schema.JsonObject): readonly SchemaIssue[] {
  return Result.match(compileAnswerSchema(sent), {
    onFailure: (issues) =>
      issues.map(({ pointer, detail }) => ({
        pointer: '',
        detail: `the portable form cannot be checked at "${pointer}": ${detail}`,
      })),
    onSuccess: (portable) => [false, true].flatMap((everyOptional) => tripIssues({ author, portable }, everyOptional)),
  });
}
