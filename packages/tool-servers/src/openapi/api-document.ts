import { JsonPointer, Predicate, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

export interface DocumentProblem {
  readonly pointer: string;
  readonly detail: string;
}

export type OpenApiVersion = '3.0' | '3.1';

const SchemaValue = Schema.Union([Schema.JsonObject, Schema.Boolean]);

const ReferenceSchema = Schema.Struct({ $ref: Schema.String });

const ParameterSchema = Schema.Struct({
  name: Schema.String,
  in: Schema.Literals(['path', 'query', 'header', 'cookie']),
  required: Schema.optionalKey(Schema.Boolean),
  description: Schema.optionalKey(Schema.String),
  style: Schema.optionalKey(Schema.String),
  explode: Schema.optionalKey(Schema.Boolean),
  schema: Schema.optionalKey(SchemaValue),
});

const MediaTypeSchema = Schema.Struct({ schema: Schema.optionalKey(SchemaValue) });

const RequestBodySchema = Schema.Struct({
  required: Schema.optionalKey(Schema.Boolean),
  content: Schema.Record(Schema.String, MediaTypeSchema),
});

const ResponseSchema = Schema.Struct({ content: Schema.optionalKey(Schema.Record(Schema.String, MediaTypeSchema)) });

const SecurityRequirementSchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

const SecuritySchemeSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('apiKey'),
    name: Schema.String,
    in: Schema.Literals(['query', 'header', 'cookie']),
  }),
  Schema.Struct({ type: Schema.Literal('http'), scheme: Schema.String }),
  Schema.Struct({ type: Schema.Literals(['oauth2', 'openIdConnect', 'mutualTLS']) }),
]);

const ParameterOrReferenceSchema = Schema.Union([ReferenceSchema, ParameterSchema]);

const RequestBodyOrReferenceSchema = Schema.Union([ReferenceSchema, RequestBodySchema]);

const ResponseOrReferenceSchema = Schema.Union([ReferenceSchema, ResponseSchema]);

const OperationSchema = Schema.Struct({
  operationId: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(Schema.Array(ParameterOrReferenceSchema)),
  requestBody: Schema.optionalKey(RequestBodyOrReferenceSchema),
  responses: Schema.optionalKey(Schema.Record(Schema.String, ResponseOrReferenceSchema)),
  security: Schema.optionalKey(Schema.Array(SecurityRequirementSchema)),
});

export const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

const PathItemSchema = Schema.Struct({
  parameters: Schema.optionalKey(Schema.Array(ParameterOrReferenceSchema)),
  get: Schema.optionalKey(OperationSchema),
  put: Schema.optionalKey(OperationSchema),
  post: Schema.optionalKey(OperationSchema),
  delete: Schema.optionalKey(OperationSchema),
  options: Schema.optionalKey(OperationSchema),
  head: Schema.optionalKey(OperationSchema),
  patch: Schema.optionalKey(OperationSchema),
  trace: Schema.optionalKey(OperationSchema),
});

const ServerSchema = Schema.Struct({
  url: Schema.String,
  variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ default: Schema.String }))),
});

const ApiDocumentSchema = Schema.Struct({
  openapi: Schema.String,
  servers: Schema.optionalKey(Schema.Array(ServerSchema)),
  security: Schema.optionalKey(Schema.Array(SecurityRequirementSchema)),
  paths: Schema.optionalKey(Schema.Record(Schema.String, PathItemSchema)),
  components: Schema.optionalKey(
    Schema.Struct({
      schemas: Schema.optionalKey(Schema.Record(Schema.String, SchemaValue)),
      parameters: Schema.optionalKey(Schema.Record(Schema.String, ParameterOrReferenceSchema)),
      requestBodies: Schema.optionalKey(Schema.Record(Schema.String, RequestBodyOrReferenceSchema)),
      responses: Schema.optionalKey(Schema.Record(Schema.String, ResponseOrReferenceSchema)),
      securitySchemes: Schema.optionalKey(Schema.Record(Schema.String, SecuritySchemeSchema)),
    }),
  ),
});

export type ApiDocument = typeof ApiDocumentSchema.Type;

export type Method = (typeof methods)[number];

export type Operation = typeof OperationSchema.Type;

export type PathItem = typeof PathItemSchema.Type;

export type Parameter = typeof ParameterSchema.Type;

export type ParameterOrReference = typeof ParameterOrReferenceSchema.Type;

export type RequestBody = typeof RequestBodySchema.Type;

export type SecurityRequirement = typeof SecurityRequirementSchema.Type;

export type SecurityScheme = typeof SecuritySchemeSchema.Type;

export type RequestBodyOrReference = typeof RequestBodyOrReferenceSchema.Type;

export type ApiResponse = typeof ResponseSchema.Type;

export type ResponseOrReference = typeof ResponseOrReferenceSchema.Type;

export interface ReadDocument {
  readonly version: OpenApiVersion;
  readonly document: ApiDocument;
}

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const decodeDocument = Schema.decodeUnknownResult(ApiDocumentSchema, { errors: 'all' });

const supportedVersion = /^3\.([01])\.\d+$/u;

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(String(segment))}`).join('');
}

function versionOf(value: unknown): Result.Result<OpenApiVersion, readonly DocumentProblem[]> {
  if (Predicate.hasProperty(value, 'swagger')) {
    return Result.fail([
      {
        pointer: '/swagger',
        detail: 'A Swagger 2.0 document, which the runtime does not read; give it the document converted to OpenAPI 3',
      },
    ]);
  }
  const declared: unknown = Predicate.hasProperty(value, 'openapi') ? value.openapi : undefined;
  const matched = typeof declared === 'string' ? supportedVersion.exec(declared) : null;
  return matched === null
    ? Result.fail([{ pointer: '/openapi', detail: 'Expected an OpenAPI document of version 3.0 or 3.1' }])
    : Result.succeed(matched[1] === '0' ? '3.0' : '3.1');
}

export function decodedDocument(value: unknown): Result.Result<ReadDocument, readonly DocumentProblem[]> {
  return Result.flatMap(versionOf(value), (version) =>
    Result.match(decodeDocument(value), {
      onSuccess: (document) => Result.succeed({ version, document }),
      onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
        Result.fail(
          formatIssues(issue).issues.map(({ message, path = [] }) => ({
            pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
            detail: message,
          })),
        ),
    }),
  );
}
