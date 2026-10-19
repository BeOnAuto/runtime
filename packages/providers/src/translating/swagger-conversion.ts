import { Schema } from 'effect';

import { authorizationServerOf, rootRequirementOf, securitySchemesOf } from './oauth2-scheme.ts';
import { isJsonFields, isJsonList, keptOperation, type JsonFields } from './openapi-operations.ts';
import {
  convertedSchema,
  fieldsAt,
  operationsIn,
  reachedSchemasOf,
  resolved,
  schemasByName,
  sourceOf,
  textAt,
  type Source,
} from './schema-conversion.ts';

type Json = Schema.Json;

type Keyword = readonly [string, Json];

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const NamesSchema = Schema.Array(NamedSchema).check(Schema.isMinLength(1));

const ReasonSchema = NamedSchema.annotate({ description: 'Why the conversion does so, in words' });

const ConvertedSourceSchema = Schema.Struct({
  address: NamedSchema.annotate({
    description: "The address of the vendor's description in JSON, a Swagger 2.0 or an OpenAPI 3 document",
  }),
  operations: NamesSchema.annotate({ description: 'The ids of the operations the document keeps from it' }),
});

export const SwaggerConversionSchema = Schema.Struct({
  sources: Schema.Array(ConvertedSourceSchema)
    .check(Schema.isMinLength(1))
    .annotate({ description: 'The descriptions converted into one OpenAPI 3.1 document, in the order it keeps' }),
  info: Schema.Struct({ title: NamedSchema, version: NamedSchema, description: NamedSchema }).annotate({
    description: 'The info of the document made',
  }),
  path_prefix: Schema.Struct({
    prefix: NamedSchema.annotate({
      description: 'The start every path kept shares, left out with the path parameter it holds',
    }),
    because: ReasonSchema,
  }),
  headers_left_out: Schema.Struct({
    names: NamesSchema.annotate({ description: 'The header parameters no operation of the document declares' }),
    because: ReasonSchema,
  }),
  lists_as_text: ReasonSchema.annotate({
    description:
      'Why a list in a query is written as one string, its values comma-separated, which its description lists',
  }),
  boolean_values_left_out: ReasonSchema.annotate({ description: 'Why a boolean parameter keeps no list of values' }),
});

export type SwaggerConversion = typeof SwaggerConversionSchema.Type;

interface Leaving {
  readonly prefix: string;
  readonly prefixParameter: string;
  readonly headersLeftOut: ReadonlySet<string>;
}

interface Converting extends Leaving {
  readonly source: Source;
}

interface ConvertedOperation {
  readonly route: string;
  readonly method: string;
  readonly operation: JsonFields;
}

interface ConvertedSource {
  readonly kept: readonly ConvertedOperation[];
  readonly reached: ReadonlyMap<string, Json>;
}

const scheme = 'oauth2';

const jsonMedia = 'application/json';

const scalarKeywords: readonly string[] = ['type', 'format', 'default', 'enum', 'minimum', 'maximum'];

const booleanKeywords: readonly string[] = scalarKeywords.filter((keyword) => keyword !== 'enum');

const describingKeywords: readonly string[] = ['tags', 'summary', 'description'];

const prefixParameterPattern = /\{([^{}]+)\}/u;

const sentenceEnd = /[.!?]$/u;

const decodeParameter = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, in: Schema.String }));

function textOf(value: Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function listedValuesOf(written: JsonFields): string {
  const values = fieldsAt(written, 'items')['enum'];
  return isJsonList(values) ? ` Comma-separated; the values: ${values.map((value) => textOf(value)).join(', ')}.` : '';
}

function describedWith(description: string, listed: string): string {
  const written = description.trim();
  const ended = listed === '' || written === '' || sentenceEnd.test(written) ? written : `${written}.`;
  return `${ended}${listed}`.trim();
}

function listSchemaOf(parameter: JsonFields): JsonFields {
  const fallback = parameter['default'];
  return {
    type: 'string',
    ...(isJsonList(fallback) ? { default: fallback.map((value) => textOf(value)).join(',') } : {}),
  };
}

function keywordsOf(written: JsonFields, keywords: readonly string[]): JsonFields {
  return Object.fromEntries(
    keywords.flatMap((keyword): readonly Keyword[] => {
      const value = written[keyword];
      return value === undefined ? [] : [[keyword, value]];
    }),
  );
}

function scalarSchemaOf(written: JsonFields): JsonFields {
  return keywordsOf(written, written['type'] === 'boolean' ? booleanKeywords : scalarKeywords);
}

function queryParameterOf(name: string, parameter: JsonFields): JsonFields {
  const schema = parameter['schema'];
  const written = isJsonFields(schema) ? schema : parameter;
  const isList = written['type'] === 'array';
  return {
    name,
    in: 'query',
    ...(parameter['required'] === true ? { required: true } : {}),
    description: describedWith(textAt(parameter, 'description') ?? '', isList ? listedValuesOf(written) : ''),
    schema: isList ? listSchemaOf(parameter) : scalarSchemaOf(written),
  };
}

function pathParameterOf(name: string, parameter: JsonFields): JsonFields {
  const description = textAt(parameter, 'description');
  return {
    name,
    in: 'path',
    required: true,
    ...(description === undefined ? {} : { description }),
    schema: { type: 'string' },
  };
}

function isLeftOut(name: string, place: string, { headersLeftOut, prefixParameter }: Converting): boolean {
  return (
    (place === 'header' && headersLeftOut.has(name.toLowerCase())) || (place === 'path' && name === prefixParameter)
  );
}

function convertedParameterOf(parameter: JsonFields, converting: Converting): readonly JsonFields[] {
  const { name, in: place } = decodeParameter(parameter);
  if (place === 'body' || isLeftOut(name, place, converting)) {
    return [];
  }
  if (place === 'path') {
    return [pathParameterOf(name, parameter)];
  }
  if (place === 'query') {
    return [queryParameterOf(name, parameter)];
  }
  throw new Error(`The operation keeps the parameter ${name} in ${place}, which the conversion writes nowhere`);
}

function bodyOf(written: JsonFields, schema: Json | undefined, references: string): JsonFields {
  const description = textAt(written, 'description');
  return {
    ...(written['required'] === true ? { required: true } : {}),
    ...(description === undefined ? {} : { description }),
    content: { [jsonMedia]: { schema: convertedSchema(schema ?? {}, references) } },
  };
}

function requestBodyOf(operation: JsonFields, parameters: readonly JsonFields[], references: string) {
  const body = parameters.find((parameter) => parameter['in'] === 'body');
  if (body !== undefined) {
    return { requestBody: bodyOf(body, body['schema'], references) };
  }
  const written = operation['requestBody'];
  return isJsonFields(written)
    ? { requestBody: bodyOf(written, fieldsAt(written['content'], jsonMedia)['schema'], references) }
    : {};
}

function responseOf(status: string, written: JsonFields, references: string): JsonFields {
  const schema = written['schema'] ?? fieldsAt(written['content'], jsonMedia)['schema'];
  return {
    description: textAt(written, 'description') ?? `HTTP ${status}`,
    ...(schema === undefined ? {} : { content: { [jsonMedia]: { schema: convertedSchema(schema, references) } } }),
  };
}

function responsesOf(operation: JsonFields, references: string): JsonFields {
  const responses = fieldsAt(operation, 'responses');
  return Object.fromEntries(
    Object.keys(responses).map((status) => [status, responseOf(status, fieldsAt(responses, status), references)]),
  );
}

function parametersIn(operation: JsonFields, { description }: Source): readonly JsonFields[] {
  const written = operation['parameters'];
  return (isJsonList(written) ? written : []).map((each) => resolved(description, each));
}

function convertedOperationOf(id: string, operation: JsonFields, converting: Converting): JsonFields {
  const { references } = converting.source;
  const parameters = parametersIn(operation, converting.source);
  return {
    operationId: id,
    ...keywordsOf(operation, describingKeywords),
    parameters: parameters.flatMap((parameter) => convertedParameterOf(parameter, converting)),
    ...requestBodyOf(operation, parameters, references),
    responses: responsesOf(operation, references),
  };
}

function routeOf(path: string, prefix: string): string {
  if (!path.startsWith(prefix)) {
    throw new Error(`The path ${path} does not start with ${prefix}, which every path the document keeps starts with`);
  }
  return path.slice(prefix.length);
}

function prefixParameterOf(prefix: string): string {
  return prefixParameterPattern.exec(prefix)?.[1] ?? '';
}

function leavingOf({ path_prefix: { prefix }, headers_left_out: { names } }: SwaggerConversion): Leaving {
  return {
    prefix,
    prefixParameter: prefixParameterOf(prefix),
    headersLeftOut: new Set(names.map((name) => name.toLowerCase())),
  };
}

function convertedSourceOf(read: unknown, operations: readonly string[], leaving: Leaving): ConvertedSource {
  const source = sourceOf(read);
  const found = operationsIn(source);
  const converting: Converting = { ...leaving, source };
  const kept = operations.map((id): ConvertedOperation => {
    const { path, method, operation } = keptOperation(found, id);
    const written = convertedOperationOf(id, operation, converting);
    return { route: routeOf(path, leaving.prefix), method, operation: written };
  });
  const reached = reachedSchemasOf(
    kept.map(({ operation }: ConvertedOperation): Json => operation),
    source,
  );
  return { kept, reached };
}

function pathsOf(operations: readonly ConvertedOperation[]): JsonFields {
  const paths = new Map<string, JsonFields>();
  for (const { route, method, operation } of operations) {
    paths.set(route, { ...paths.get(route), [method]: operation });
  }
  return Object.fromEntries(paths);
}

export function convertedDocumentOf(
  documents: readonly unknown[],
  conversion: SwaggerConversion,
  metadata: unknown,
): JsonFields {
  const server = authorizationServerOf(metadata);
  const leaving = leavingOf(conversion);
  const converted = conversion.sources.map(({ operations }, index) =>
    convertedSourceOf(documents[index], operations, leaving),
  );
  return {
    openapi: '3.1.0',
    info: conversion.info,
    security: rootRequirementOf(scheme),
    paths: pathsOf(converted.flatMap(({ kept }: ConvertedSource) => kept)),
    components: {
      schemas: schemasByName(converted.map(({ reached }: ConvertedSource) => reached)),
      securitySchemes: securitySchemesOf(scheme, server, {}),
    },
  };
}
