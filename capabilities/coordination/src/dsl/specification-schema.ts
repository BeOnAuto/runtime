import type { SchemaObject, Validator } from '@hyperjump/json-schema/draft-2020-12';
import {
  allTaskEntries,
  entriesOf,
  field,
  isList,
  isObject,
  valueAtPointer,
  type Json,
  type JsonEntry,
  type JsonObject,
} from '@on.auto/workflow-engine';
import { Schema } from 'effect';

import { schemaValidator, specificationSdk, type SchemaValidator } from './dsl-libraries.ts';

export interface SchemaRefusal {
  readonly keyword: string;
  readonly at: string;
  readonly pointer: string;
  readonly rule: Json | undefined;
  readonly value: Json | undefined;
}

export interface SchemaCheck {
  readonly base: string;
  readonly task: boolean;
  readonly refusals: readonly SchemaRefusal[];
}

type Instance = Parameters<Validator>[0];

type Check = (instance: Json) => readonly SchemaRefusal[];

interface Checks {
  readonly document: Check;
  readonly task: Check;
}

interface RefusedUnit {
  readonly absoluteKeywordLocation: string;
  readonly instanceLocation: string;
  readonly errors?: readonly RefusedUnit[];
}

interface Place {
  readonly at: string;
  readonly location: string;
}

interface Specification {
  readonly id: string;
  readonly schema: JsonObject;
}

const taskDefinition = '#/$defs/task';

const schemaKeywords: ReadonlySet<string> = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

const schemaLists: ReadonlySet<string> = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

const schemaMaps: ReadonlySet<string> = new Set(['$defs', 'dependentSchemas', 'patternProperties', 'properties']);

function readSchema(schema: Json): Json {
  if (schema === false) {
    return { not: {} };
  }
  if (!isObject(schema)) {
    return schema;
  }
  return field(schema, '$ref') === taskDefinition ? { type: 'object' } : readObject(schema);
}

function readObject(schema: JsonObject): JsonObject {
  return Object.fromEntries(
    entriesOf(schema).map(([keyword, value]: JsonEntry): JsonEntry => [keyword, readKeyword(keyword, value)]),
  );
}

function readKeyword(keyword: string, value: Json): Json {
  if (schemaKeywords.has(keyword)) {
    return readSchema(value);
  }
  if (schemaLists.has(keyword) && isList(value)) {
    return value.map((schema) => readSchema(schema));
  }
  return schemaMaps.has(keyword) && isObject(value) ? readMembers(value) : value;
}

function readMembers(members: JsonObject): JsonObject {
  return Object.fromEntries(
    entriesOf(members).map(([name, member]: JsonEntry): JsonEntry => [name, readSchema(member)]),
  );
}

const publishedOf = Schema.decodeUnknownSync(
  Schema.StructWithRest(Schema.Struct({ $id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
);

let compiling: Promise<Checks> | undefined;

export async function schemaChecksOf(document: JsonObject): Promise<readonly SchemaCheck[]> {
  compiling ??= compiledChecks();
  const checks = await compiling;
  return [
    { base: '', task: false, refusals: checks.document(document) },
    ...allTaskEntries(field(document, 'do'), '/do').map(({ task, reference }) => ({
      base: reference,
      task: true,
      refusals: checks.task(task),
    })),
  ];
}

async function compiledChecks(): Promise<Checks> {
  const [{ workflowSchema }, { registerSchema, validate }] = await Promise.all([specificationSdk(), schemaValidator()]);
  const published = publishedOf(workflowSchema);
  const specification: Specification = { id: published.$id, schema: readObject(published) };
  registerSchema(schemaObjectOf(specification.schema));
  const [document, task] = await Promise.all([
    checkAt(validate, specification, '#'),
    checkAt(validate, specification, taskDefinition),
  ]);
  return { document, task };
}

async function checkAt(
  validate: SchemaValidator['validate'],
  specification: Specification,
  definition: string,
): Promise<Check> {
  const root: Place = { at: '#', location: `${specification.id}${definition}` };
  const validator = await validate(root.location);
  return (instance) => {
    const output = validator(instanceOf(instance), 'DETAILED');
    return output.valid ? [] : refusalsIn(output.errors, root, instance, specification.schema);
  };
}

function refusalsIn(
  units: readonly RefusedUnit[] | undefined,
  parent: Place,
  instance: Json,
  schema: JsonObject,
): readonly SchemaRefusal[] {
  return (units ?? []).flatMap((unit) => {
    const place = placeOf(unit.absoluteKeywordLocation, parent);
    const pointer = decodeURI(fragmentOf(unit.instanceLocation));
    const refusal: SchemaRefusal = {
      keyword: place.at.slice(place.at.lastIndexOf('/') + 1),
      at: place.at,
      pointer,
      rule: valueAtPointer(schema, decodeURI(fragmentOf(place.location))),
      value: valueAtPointer(instance, pointer),
    };
    return [refusal].concat(refusalsIn(unit.errors, place, instance, schema));
  });
}

function placeOf(location: string, parent: Place): Place {
  const step = location.startsWith(`${parent.location}/`)
    ? location.slice(parent.location.length)
    : location.slice(location.lastIndexOf('/'));
  return { at: `${parent.at}${step}`, location };
}

function fragmentOf(uri: string): string {
  return uri.slice(uri.indexOf('#') + 1);
}

function schemaObjectOf(schema: JsonObject): SchemaObject {
  return Object.fromEntries(entriesOf(schema).map(([key, value]: JsonEntry) => [key, instanceOf(value)]));
}

function instanceOf(value: Json): Instance {
  if (isList(value)) {
    return value.map((item) => instanceOf(item));
  }
  return isObject(value) ? schemaObjectOf(value) : value;
}
