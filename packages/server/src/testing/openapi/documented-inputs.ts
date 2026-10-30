import type { DocumentedOperation, ListedTool } from '@on.auto/api/testing';
import { Schema } from 'effect';

type JsonObject = Readonly<Record<string, unknown>>;

interface InputField {
  readonly name: string;
  readonly required: boolean;
  readonly schema: unknown;
}

const ObjectSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ParameterSchema = Schema.Struct({
  name: Schema.String,
  in: Schema.Literals(['path', 'query']),
  required: Schema.Boolean,
  schema: Schema.Unknown,
});

const JsonBodySchema = Schema.Struct({
  content: Schema.Struct({
    'application/json': Schema.Struct({ schema: Schema.Record(Schema.String, Schema.Unknown) }),
  }),
});

const objectOf = Schema.decodeUnknownSync(ObjectSchema);

const parametersOf = Schema.decodeUnknownSync(
  Schema.Array(Schema.Union([ParameterSchema, Schema.Struct({ $ref: Schema.String })])),
);

const jsonBodyOf = Schema.decodeUnknownSync(JsonBodySchema);

function withoutKeywords(schema: JsonObject, keywords: readonly string[]): JsonObject {
  return Object.fromEntries(
    Object.entries(schema).filter(([keyword]: readonly [string, unknown]) => !keywords.includes(keyword)),
  );
}

function namedParametersOf({ operation }: DocumentedOperation): readonly (typeof ParameterSchema.Type)[] {
  return parametersOf(operation.parameters).flatMap((parameter) => ('name' in parameter ? [parameter] : []));
}

function pathFieldsOf(described: DocumentedOperation): readonly string[] {
  return namedParametersOf(described)
    .filter((parameter) => parameter.in === 'path')
    .map(({ name }) => name);
}

function withoutFields(schema: JsonObject, names: readonly string[]): JsonObject {
  const { properties = {}, required = [] } = objectOf(schema);
  const kept = required.filter((name) => !names.includes(name));
  return {
    ...withoutKeywords(schema, ['properties', 'required', '$defs']),
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]: readonly [string, unknown]) => !names.includes(name)),
    ),
    ...(kept.length === 0 ? {} : { required: kept }),
  };
}

const methodsWithoutABody: ReadonlySet<string> = new Set(['get', 'delete']);

function fieldsIn(schema: JsonObject): readonly InputField[] {
  const { properties = {}, required = [] } = objectOf(schema);
  return Object.entries(properties).map(([name, field]: readonly [string, unknown]) => ({
    name,
    required: required.includes(name),
    schema: field,
  }));
}

export function documentedInputOf(described: DocumentedOperation): unknown {
  if (methodsWithoutABody.has(described.method)) {
    return namedParametersOf(described)
      .filter((parameter) => parameter.in === 'query')
      .map(({ name, required, schema }) => ({ name, required, schema }));
  }
  const { schema } = jsonBodyOf(described.operation.requestBody).content['application/json'];
  return withoutKeywords(schema, ['$id', '$defs']);
}

export function inputOfToolsOf(described: DocumentedOperation, tools: readonly ListedTool[]): readonly unknown[] {
  const inputs = tools.map(({ inputSchema }) => withoutFields(inputSchema, pathFieldsOf(described)));
  return methodsWithoutABody.has(described.method) ? inputs.map((input) => fieldsIn(input)) : inputs;
}
