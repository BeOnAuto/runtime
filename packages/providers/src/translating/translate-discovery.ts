import { readFile, writeFile } from 'node:fs/promises';

import {
  authorizationServerOf,
  componentReferenceOf,
  discoveryDocumentOf,
  methodsOf,
  referencesIn,
  translatedSchema,
  type AuthorizationServer,
  type DiscoveryDocument,
  type DiscoveryMethod,
  type Json,
  type JsonObject,
} from './discovery-document.ts';

interface Described {
  readonly description?: string;
}

type DeclaredParameters = NonNullable<DiscoveryMethod['parameters']>;

const securitySchemeName = 'oauth2';

const fieldsParameterName = 'fields';

const parameterKeywords: ReadonlySet<string> = new Set(['location', 'required', 'repeated', 'description']);

const pathParameterKeywords: ReadonlySet<string> = new Set([...parameterKeywords, 'pattern']);

const templatedSegment = /\{\+?([^{}]+)\}/gu;

const singleSegment = '^[^/]+$';

function keptMethodsOf(discovery: DiscoveryDocument, methodIds: readonly string[]): readonly DiscoveryMethod[] {
  const wanted = new Set(methodIds);
  const kept = methodsOf(discovery).filter(({ id }) => wanted.has(id));
  const found = new Set(kept.map(({ id }) => id));
  const missing = [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`The Discovery document has no method ${missing.join(', ')}`);
  }
  return kept;
}

function pathOf(method: DiscoveryMethod): string {
  return `/${(method.flatPath ?? method.path).replaceAll(templatedSegment, '{$1}')}`;
}

function pathNamesOf(path: string): readonly string[] {
  return (path.match(templatedSegment) ?? []).map((segment) => segment.replaceAll(/^\{\+?|\}$/gu, ''));
}

function describedBy(parameter: JsonObject | undefined): Described {
  const description = parameter?.['description'];
  return typeof description === 'string' ? { description } : {};
}

function parameterSchemaOf(parameter: JsonObject, leftOut: ReadonlySet<string>): Json {
  const schema = translatedSchema(
    Object.fromEntries(Object.entries(parameter).filter(([keyword]: readonly [string, Json]) => !leftOut.has(keyword))),
  );
  return parameter['repeated'] === true ? { type: 'array', items: schema } : schema;
}

function declaredPathParameter(declared: DeclaredParameters, name: string): JsonObject | undefined {
  const parameter = Object.hasOwn(declared, name) ? declared[name] : undefined;
  return parameter?.['location'] === 'path' ? parameter : undefined;
}

function renamedPathParameter(
  writtenPath: string,
  declared: DeclaredParameters,
  flatNames: readonly string[],
  position: number,
): JsonObject | undefined {
  const writtenNames = pathNamesOf(writtenPath);
  const written = writtenNames.length === flatNames.length ? writtenNames[position] : undefined;
  const renamed = written === undefined ? undefined : declaredPathParameter(declared, written);
  return renamed !== undefined && renamed['pattern'] === singleSegment ? renamed : undefined;
}

function pathParametersOf(method: DiscoveryMethod, declared: DeclaredParameters): readonly JsonObject[] {
  const flatNames = pathNamesOf(pathOf(method));
  return flatNames.map((name, position) =>
    pathParameterOf(
      name,
      declaredPathParameter(declared, name) ?? renamedPathParameter(method.path, declared, flatNames, position),
    ),
  );
}

function pathParameterOf(name: string, declared: JsonObject | undefined): JsonObject {
  return {
    name,
    in: 'path',
    required: true,
    ...describedBy(declared),
    schema: declared === undefined ? { type: 'string' } : parameterSchemaOf(declared, pathParameterKeywords),
  };
}

function queryParameterOf([name, parameter]: readonly [string, JsonObject]): readonly JsonObject[] {
  if (parameter['location'] !== 'query') {
    return [];
  }
  const required = parameter['required'] === true;
  return [
    {
      name,
      in: 'query',
      ...(required ? { required } : {}),
      ...describedBy(parameter),
      schema: parameterSchemaOf(parameter, parameterKeywords),
    },
  ];
}

function fieldsParameterOf(discovery: DiscoveryDocument): readonly JsonObject[] {
  const fields = discovery.parameters?.[fieldsParameterName];
  return fields === undefined
    ? []
    : [{ name: fieldsParameterName, in: 'query', ...describedBy(fields), schema: { type: 'string' } }];
}

function parametersOf(method: DiscoveryMethod, fields: readonly JsonObject[]): readonly JsonObject[] {
  const declared = method.parameters ?? {};
  return [
    ...pathParametersOf(method, declared),
    ...Object.entries(declared).flatMap((each: readonly [string, JsonObject]) => queryParameterOf(each)),
    ...(Object.hasOwn(declared, fieldsParameterName) ? [] : fields),
  ];
}

function jsonContentOf(name: string): JsonObject {
  return { 'application/json': { schema: { $ref: componentReferenceOf(name) } } };
}

function requestBodyOf({ request }: DiscoveryMethod): { readonly requestBody?: JsonObject } {
  return request === undefined ? {} : { requestBody: { required: true, content: jsonContentOf(request.$ref) } };
}

function responsesOf({ response }: DiscoveryMethod): JsonObject {
  return {
    '2XX':
      response === undefined
        ? { description: 'An empty body' }
        : { description: response.$ref, content: jsonContentOf(response.$ref) },
  };
}

function securityOf({ scopes = [] }: DiscoveryMethod): { readonly security?: readonly JsonObject[] } {
  return scopes.length === 0 ? {} : { security: scopes.map((scope) => ({ [securitySchemeName]: [scope] })) };
}

function operationOf(method: DiscoveryMethod, fields: readonly JsonObject[]): JsonObject {
  return {
    operationId: method.id,
    ...(method.description === undefined ? {} : { description: method.description }),
    ...(method.deprecated === true ? { deprecated: true } : {}),
    parameters: parametersOf(method, fields),
    ...requestBodyOf(method),
    responses: responsesOf(method),
    ...securityOf(method),
  };
}

function pathsOf(methods: readonly DiscoveryMethod[], fields: readonly JsonObject[]): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const method of methods) {
    const path = pathOf(method);
    paths[path] = { ...paths[path], [method.httpMethod.toLowerCase()]: operationOf(method, fields) };
  }
  return paths;
}

function rootSchemasOf(methods: readonly DiscoveryMethod[]): readonly string[] {
  return methods.flatMap(({ request, response }) => [request?.$ref ?? [], response?.$ref ?? []].flat());
}

function schemaNamed(discovery: DiscoveryDocument, name: string): JsonObject {
  const schemas = discovery.schemas ?? {};
  const schema = Object.hasOwn(schemas, name) ? schemas[name] : undefined;
  if (schema === undefined) {
    throw new Error(`The Discovery document refers to the schema ${name}, which it does not have`);
  }
  return schema;
}

function componentSchemasOf(discovery: DiscoveryDocument, methods: readonly DiscoveryMethod[]): JsonObject {
  const reached = new Set<string>();
  const pending = [...rootSchemasOf(methods)];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (!reached.has(name)) {
      reached.add(name);
      pending.push(...referencesIn(schemaNamed(discovery, name)));
    }
  }
  return Object.fromEntries(
    [...reached]
      .toSorted()
      .map((name): readonly [string, Json] => [name, translatedSchema(schemaNamed(discovery, name))]),
  );
}

function scopesOf(discovery: DiscoveryDocument): JsonObject {
  return Object.fromEntries(
    Object.entries(discovery.auth?.oauth2.scopes ?? {}).map(
      ([scope, { description }]: readonly [string, Required<Described>]): readonly [string, Json] => [
        scope,
        description,
      ],
    ),
  );
}

function infoOf({ name, title, version, description }: DiscoveryDocument): JsonObject {
  return { title: title ?? name, version, ...(description === undefined ? {} : { description }) };
}

function securitySchemesOf(discovery: DiscoveryDocument, server: AuthorizationServer): JsonObject {
  return {
    [securitySchemeName]: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: server.authorization_endpoint,
          tokenUrl: server.token_endpoint,
          scopes: scopesOf(discovery),
        },
      },
    },
  };
}

export function curatedDocumentOf(
  discovery: DiscoveryDocument,
  server: AuthorizationServer,
  methodIds: readonly string[],
): JsonObject {
  const methods = keptMethodsOf(discovery, methodIds);
  return {
    openapi: '3.1.0',
    info: infoOf(discovery),
    ...(discovery.documentationLink === undefined ? {} : { externalDocs: { url: discovery.documentationLink } }),
    servers: [{ url: `${discovery.rootUrl}${discovery.servicePath}`.replace(/\/+$/u, '') }],
    paths: pathsOf(methods, fieldsParameterOf(discovery)),
    components: {
      schemas: componentSchemasOf(discovery, methods),
      securitySchemes: securitySchemesOf(discovery, server),
    },
  };
}

async function jsonIn(path: string): Promise<unknown> {
  const read: unknown = JSON.parse(await readFile(path, 'utf8'));
  return read;
}

export async function translateDiscovery(
  source: string,
  metadata: string,
  target: string,
  methodIds: readonly string[],
): Promise<void> {
  const discovery = discoveryDocumentOf(await jsonIn(source));
  const document = curatedDocumentOf(discovery, authorizationServerOf(await jsonIn(metadata)), methodIds);
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
}

const usage =
  'Usage: node translate-discovery.ts <discovery document> <authorization server metadata> <curated document> <method id>...';

export async function runTranslation(commandArguments: readonly string[]): Promise<void> {
  const [source, metadata, target, ...methodIds] = commandArguments;
  if (source === undefined || metadata === undefined || target === undefined || methodIds.length === 0) {
    throw new Error(usage);
  }
  await translateDiscovery(source, metadata, target, methodIds);
}

if (import.meta.main) {
  await runTranslation(process.argv.slice(2));
}
