import type { JsonSchemaDocument } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import {
  inlinedRootOf,
  selfContainedSchemaOf,
  withoutUnreferencedDefinitions,
  type JsonSchema,
} from '../tools/tool-schema.ts';

const schemaBase = 'https://on.auto/schemas/runtime';

export type SchemaRole = 'input' | 'output';

type Definitions = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const ObjectFieldsSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
  $defs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const UnionSchema = Schema.Struct({
  anyOf: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  $defs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const objectFieldsOf = Schema.decodeUnknownSync(ObjectFieldsSchema);

const unionOf = Schema.decodeUnknownOption(UnionSchema);

export interface Field {
  readonly name: string;
  readonly schema: Readonly<JsonSchema>;
  readonly required: boolean;
}

export function identifiedSchemaOf(schema: Readonly<JsonSchema>, id: string): JsonSchema {
  return { $schema: schema['$schema'], $id: `${schemaBase}/${id}`, ...schema };
}

export function schemaOf(document: JsonSchemaDocument, operationId: string, role: SchemaRole): JsonSchema {
  return identifiedSchemaOf(withoutUnreferencedDefinitions(selfContainedSchemaOf(document)), `${operationId}/${role}`);
}

function withoutKeywords(schema: Readonly<JsonSchema>, keywords: readonly string[]): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([keyword]: readonly [string, unknown]) => !keywords.includes(keyword)),
  );
}

function objectWithout(object: Readonly<JsonSchema>, names: readonly string[]): JsonSchema {
  const { properties = {}, required = [] } = objectFieldsOf(object);
  const kept = required.filter((name) => !names.includes(name));
  return {
    ...withoutKeywords(object, ['properties', 'required']),
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]: readonly [string, unknown]) => !names.includes(name)),
    ),
    ...(kept.length === 0 ? {} : { required: kept }),
  };
}

export function isUnion(schema: Readonly<JsonSchema>): boolean {
  return Option.isSome(unionOf(schema));
}

export function withoutFields(schema: Readonly<JsonSchema>, names: readonly string[]): JsonSchema {
  const fewer = Option.match(unionOf(schema), {
    onNone: () => objectWithout(schema, names),
    onSome: ({ anyOf, $defs = {} }) => ({
      ...schema,
      anyOf: anyOf.map((member) => objectWithout(inlinedRootOf({ schema: member, definitions: $defs }), names)),
    }),
  });
  return withoutUnreferencedDefinitions(fewer);
}

function fieldsOfObject(object: Readonly<JsonSchema>, definitions: Definitions): readonly Field[] {
  const { properties = {}, required = [] } = objectFieldsOf(object);
  return Object.entries(properties).map(([name, field]: readonly [string, Readonly<JsonSchema>]) => ({
    name,
    schema: inlinedRootOf({ schema: field, definitions }),
    required: required.includes(name),
  }));
}

export function fieldsOf(schema: Readonly<JsonSchema>): readonly Field[] {
  const { $defs = {} } = objectFieldsOf(schema);
  return fieldsOfObject(schema, $defs);
}

export function fieldsOfEveryMember(schema: Readonly<JsonSchema>): readonly Field[] {
  return Option.match(unionOf(schema), {
    onNone: () => fieldsOf(schema),
    onSome: ({ anyOf, $defs = {} }) =>
      anyOf.flatMap((member) => fieldsOfObject(inlinedRootOf({ schema: member, definitions: $defs }), $defs)),
  });
}
