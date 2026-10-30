import formats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Predicate, Result, Schema } from 'effect';

import publishedSchema from './openapi-3.1-schema-2022-10-07.json' with { type: 'json' };

type JsonObject = Readonly<Record<string, unknown>>;

const asJsonObject = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

const dynamicSchemaReference = '"$dynamicRef":"#meta"';

const staticSchemaReference = '"$ref":"#/$defs/schema"';

function withSchemaObjectsReferencedStatically(schema: JsonObject): JsonObject {
  const resolved: unknown = JSON.parse(
    JSON.stringify(schema).replaceAll(dynamicSchemaReference, staticSchemaReference),
  );
  return asJsonObject(resolved);
}

const openApiSchema = withSchemaObjectsReferencedStatically(publishedSchema);

function validator(strict: boolean): Ajv2020 {
  const ajv = new Ajv2020({ strict, allErrors: true, formats: { 'media-range': true } });
  formats.default(ajv);
  return ajv;
}

function errorsOf(strict: boolean, schema: JsonObject, value: unknown): readonly string[] {
  const ajv = validator(strict);
  const validate = ajv.compile(schema);
  return validate(value) ? [] : ajv.errorsText(validate.errors, { separator: '\n' }).split('\n');
}

export function openApiErrorsIn(document: unknown): readonly string[] {
  return errorsOf(false, openApiSchema, document);
}

export function schemaErrorsIn(schema: JsonObject, value: unknown): readonly string[] {
  return errorsOf(true, schema, value);
}

const OpenApiObjectSchema = Schema.Record(Schema.String, Schema.Unknown);

const DocumentedOperationSchema = Schema.Struct({
  operationId: Schema.String,
  summary: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  parameters: Schema.Array(OpenApiObjectSchema),
  requestBody: Schema.optionalKey(OpenApiObjectSchema),
  responses: Schema.Record(Schema.String, OpenApiObjectSchema),
  security: Schema.Array(Schema.Record(Schema.String, Schema.Array(Schema.String))),
});

const PathsSchema = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, DocumentedOperationSchema)),
});

type Operation = typeof DocumentedOperationSchema.Type;

export interface DocumentedOperation {
  readonly path: string;
  readonly method: string;
  readonly operation: Operation;
}

export function operationsIn(document: unknown): readonly DocumentedOperation[] {
  const { paths } = Schema.decodeUnknownSync(PathsSchema)(document);
  return Object.entries(paths).flatMap(([path, item]: readonly [string, Readonly<Record<string, Operation>>]) =>
    Object.entries(item).map(([method, operation]: readonly [string, Operation]) => ({ path, method, operation })),
  );
}

function identifiedSchemasIn(value: unknown): readonly JsonObject[] {
  if (!Predicate.isObject(value)) {
    return [];
  }
  const nested = Object.values(value).flatMap((member: unknown) => identifiedSchemasIn(member));
  return Predicate.hasProperty(value, '$id') && typeof value.$id === 'string'
    ? [asJsonObject(value), ...nested]
    : nested;
}

export function unresolvedSchemasIn(document: unknown): readonly string[] {
  return identifiedSchemasIn(document).flatMap((schema) =>
    Result.match(
      Result.try({
        try: () => validator(true).compile(schema),
        catch: (error) => `${String(schema['$id'])}: ${String(error)}`,
      }),
      { onSuccess: () => [], onFailure: (failure) => [failure] },
    ),
  );
}
