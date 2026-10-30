import { operationsIn, schemaErrorsIn, type DocumentedOperation } from '@on.auto/api/testing';
import { Schema } from 'effect';

type JsonObject = Readonly<Record<string, unknown>>;

interface Answered {
  readonly status: number;
  readonly body: unknown;
  readonly misfits: readonly string[];
}

export type DocumentClient = (operationId: string, input: JsonObject) => Promise<Answered>;

const AnySchema = Schema.Record(Schema.String, Schema.Unknown);

const ParameterSchema = Schema.Struct({ name: Schema.String, in: Schema.Literals(['path', 'query']) });

const ComponentsSchema = Schema.Struct({
  servers: Schema.Tuple([Schema.Struct({ url: Schema.String })]),
  components: Schema.Struct({
    schemas: Schema.Struct({ problem: AnySchema }),
    parameters: Schema.Record(Schema.String, ParameterSchema),
  }),
});

const ParameterOrReferenceSchema = Schema.Union([ParameterSchema, Schema.Struct({ $ref: Schema.String })]);

const JsonContentSchema = Schema.Struct({
  content: Schema.Struct({ 'application/json': Schema.Struct({ schema: AnySchema }) }),
});

const parameterOf = Schema.decodeUnknownSync(ParameterSchema);

const jsonSchemaOf = Schema.decodeUnknownSync(JsonContentSchema);

const parameterReference = '#/components/parameters/';

interface Described {
  readonly described: DocumentedOperation;
  readonly parameters: readonly (typeof ParameterSchema.Type)[];
}

function describedBy(document: unknown): (operationId: string) => Described {
  const { components } = Schema.decodeUnknownSync(ComponentsSchema)(document);
  const operations = operationsIn(document);
  return (operationId) => {
    const described = operations.find(({ operation }) => operation.operationId === operationId);
    if (described === undefined) {
      throw new Error(`The document describes no operation ${operationId}`);
    }
    const parameters = Schema.decodeUnknownSync(Schema.Array(ParameterOrReferenceSchema))(
      described.operation.parameters,
    ).map((parameter) =>
      'name' in parameter
        ? parameter
        : parameterOf(components.parameters[parameter.$ref.slice(parameterReference.length)]),
    );
    return { described, parameters };
  };
}

function urlOf(base: string, { described, parameters }: Described, input: JsonObject): URL {
  const path = parameters
    .filter((parameter) => parameter.in === 'path')
    .reduce((filled, { name }) => filled.replace(`{${name}}`, encodeURIComponent(String(input[name]))), described.path);
  const url = new URL(`${base}${path}`);
  const given = parameters.filter((parameter) => parameter.in === 'query' && input[parameter.name] !== undefined);
  for (const { name } of given) {
    url.searchParams.set(name, String(input[name]));
  }
  return url;
}

function bodyOf({ parameters }: Described, input: JsonObject): JsonObject {
  const named = new Set(parameters.map(({ name }) => name));
  return Object.fromEntries(Object.entries(input).filter(([name]: readonly [string, unknown]) => !named.has(name)));
}

export function documentClientOf(document: unknown, documentUrl: string): DocumentClient {
  const { servers, components } = Schema.decodeUnknownSync(ComponentsSchema)(document);
  const base = new URL(servers[0].url, documentUrl).href;
  const describe = describedBy(document);
  return async (operationId, input) => {
    const described = describe(operationId);
    const { requestBody, responses } = described.described.operation;
    const body = requestBody === undefined ? undefined : bodyOf(described, input);
    const misfits =
      body === undefined ? [] : schemaErrorsIn(jsonSchemaOf(requestBody).content['application/json'].schema, body);
    const response = await fetch(urlOf(base, described, input), {
      method: described.described.method.toUpperCase(),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const answer: unknown = await response.json();
    const documented = Schema.decodeUnknownSync(AnySchema)(responses[String(response.status)]);
    const schema =
      '$ref' in documented ? components.schemas.problem : jsonSchemaOf(documented).content['application/json'].schema;
    return { status: response.status, body: answer, misfits: [...misfits, ...schemaErrorsIn(schema, answer)] };
  };
}
