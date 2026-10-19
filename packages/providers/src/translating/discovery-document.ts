import { JsonPointer, Order, Predicate, Schema } from 'effect';

export type Json = Schema.Json;

export type JsonObject = Schema.JsonObject;

type Keyword = readonly [string, Json];

export const byName: Order.Order<readonly [string, unknown]> = Order.mapInput(
  Order.String,
  ([name]: readonly [string, unknown]) => name,
);

const ReferenceSchema = Schema.Struct({ $ref: Schema.String });

const DiscoveryMethodSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  flatPath: Schema.optionalKey(Schema.String),
  httpMethod: Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  description: Schema.optionalKey(Schema.String),
  deprecated: Schema.optionalKey(Schema.Boolean),
  parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.JsonObject)),
  request: Schema.optionalKey(ReferenceSchema),
  response: Schema.optionalKey(ReferenceSchema),
  scopes: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type DiscoveryMethod = typeof DiscoveryMethodSchema.Type;

interface DiscoveryResource {
  readonly methods?: { readonly [name: string]: DiscoveryMethod };
  readonly resources?: { readonly [name: string]: DiscoveryResource };
}

const DiscoveryResourceSchema: Schema.Codec<DiscoveryResource> = Schema.Struct({
  methods: Schema.optionalKey(Schema.Record(Schema.String, DiscoveryMethodSchema)),
  resources: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<DiscoveryResource> => DiscoveryResourceSchema),
    ),
  ),
});

const ScopesSchema = Schema.Record(Schema.String, Schema.Struct({ description: Schema.String }));

const DiscoveryDocumentSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  revision: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  documentationLink: Schema.optionalKey(Schema.String),
  rootUrl: Schema.String,
  servicePath: Schema.String,
  parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.JsonObject)),
  auth: Schema.optionalKey(Schema.Struct({ oauth2: Schema.Struct({ scopes: ScopesSchema }) })),
  schemas: Schema.optionalKey(Schema.Record(Schema.String, Schema.JsonObject)),
  methods: Schema.optionalKey(Schema.Record(Schema.String, DiscoveryMethodSchema)),
  resources: Schema.optionalKey(Schema.Record(Schema.String, DiscoveryResourceSchema)),
});

export type DiscoveryDocument = typeof DiscoveryDocumentSchema.Type;

const AuthorizationServerSchema = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
});

export type AuthorizationServer = typeof AuthorizationServerSchema.Type;

const discoveryKeywords: ReadonlySet<string> = new Set(['id', 'enumDescriptions', 'enumDeprecated', 'annotations']);

const childSchemaKeywords: ReadonlySet<string> = new Set(['items', 'additionalProperties']);

const boundKeywords: ReadonlySet<string> = new Set(['minimum', 'maximum']);

const decodeDiscoveryDocument = Schema.decodeUnknownSync(DiscoveryDocumentSchema);

const decodeAuthorizationServer = Schema.decodeUnknownSync(AuthorizationServerSchema);

export function discoveryDocumentOf(value: unknown): DiscoveryDocument {
  return decodeDiscoveryDocument(value);
}

export function authorizationServerOf(value: unknown): AuthorizationServer {
  return decodeAuthorizationServer(value);
}

export function methodsOf(resource: DiscoveryResource): readonly DiscoveryMethod[] {
  return [
    ...Object.values(resource.methods ?? {}),
    ...Object.values(resource.resources ?? {}).flatMap((each) => methodsOf(each)),
  ];
}

function isJsonObject(value: Json | undefined): value is JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function isJsonList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

export function componentReferenceOf(name: string): string {
  return `#/components/schemas/${JsonPointer.escapeToken(name)}`;
}

function isDiscoveryOnly(keyword: string, value: Json): boolean {
  return discoveryKeywords.has(keyword) || (keyword === 'type' && value === 'any');
}

function boundOf(written: string): number | undefined {
  const bound = Number(written);
  return Number.isFinite(bound) ? bound : undefined;
}

function translatedProperties(properties: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(properties)
      .toSorted(byName)
      .map(([name, schema]: Keyword): Keyword => [name, translatedSchema(schema)]),
  );
}

function translatedValue(keyword: string, value: Json): Json | undefined {
  if (keyword === '$ref' && typeof value === 'string') {
    return componentReferenceOf(value);
  }
  if (keyword === 'properties' && isJsonObject(value)) {
    return translatedProperties(value);
  }
  if (childSchemaKeywords.has(keyword)) {
    return translatedSchema(value);
  }
  return boundKeywords.has(keyword) && typeof value === 'string' ? boundOf(value) : value;
}

function translatedKeyword([keyword, value]: Keyword): readonly Keyword[] {
  const translated = isDiscoveryOnly(keyword, value) ? undefined : translatedValue(keyword, value);
  return translated === undefined ? [] : [[keyword, translated]];
}

export function translatedSchema(schema: Json): Json {
  return isJsonObject(schema)
    ? Object.fromEntries(
        Object.entries(schema)
          .toSorted(byName)
          .flatMap((each: Keyword) => translatedKeyword(each)),
      )
    : schema;
}

export function referencesIn(value: Json): readonly string[] {
  if (isJsonList(value)) {
    return value.flatMap((each) => referencesIn(each));
  }
  if (!isJsonObject(value)) {
    return [];
  }
  const reference = value['$ref'];
  return [
    ...(typeof reference === 'string' ? [reference] : []),
    ...Object.values(value).flatMap((each) => referencesIn(each)),
  ];
}
