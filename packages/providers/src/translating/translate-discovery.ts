import { discoveryCut, type Cut } from './discovery-cuts.ts';
import {
  byName,
  componentReferenceOf,
  discoveryDocumentOf,
  methodsOf,
  referencesIn,
  translatedSchema,
  type DiscoveryDocument,
  type DiscoveryMethod,
  type Json,
  type JsonObject,
} from './discovery-document.ts';
import { discoveryParametersChanged, type ParameterChanges } from './discovery-parameters.ts';
import {
  authorizationServerOf,
  requirementsOf,
  rootRequirementOf,
  securitySchemesOf,
  type AuthorizationServer,
} from './oauth2-scheme.ts';

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

interface KeptMethod extends DiscoveryMethod {
  readonly scopes: readonly string[];
}

function isScoped(method: DiscoveryMethod): method is KeptMethod {
  return method.scopes !== undefined && method.scopes.length > 0;
}

function keptMethodsOf(discovery: DiscoveryDocument, methodIds: readonly string[]): readonly KeptMethod[] {
  const byId = new Map(methodsOf(discovery).map((method) => [method.id, method]));
  const kept: DiscoveryMethod[] = [];
  const missing: string[] = [];
  for (const id of new Set(methodIds)) {
    const method = byId.get(id);
    if (method === undefined) {
      missing.push(id);
    } else {
      kept.push(method);
    }
  }
  if (missing.length > 0) {
    throw new Error(`The Discovery document has no method ${missing.join(', ')}`);
  }
  const unscoped = kept.filter((method) => !isScoped(method)).map(({ id }) => id);
  if (unscoped.length > 0) {
    throw new Error(
      `The Discovery document lists no scope for the method ${unscoped.join(', ')}, so a call of it would send no token`,
    );
  }
  return kept.filter((method) => isScoped(method));
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
    ...Object.entries(declared)
      .toSorted(byName)
      .flatMap((each: readonly [string, JsonObject]) => queryParameterOf(each)),
    ...(Object.hasOwn(declared, fieldsParameterName) ? [] : fields),
  ];
}

function jsonContentOf(name: string): JsonObject {
  return { 'application/json': { schema: { $ref: componentReferenceOf(name) } } };
}

function requestBodyOf({ request }: DiscoveryMethod): { readonly requestBody?: JsonObject } {
  return request === undefined ? {} : { requestBody: { required: true, content: jsonContentOf(request.$ref) } };
}

function unnamedAnswerOf({ supportsMediaDownload }: DiscoveryMethod): string {
  return supportsMediaDownload === true ? 'The media the method downloads' : 'An empty body';
}

function responsesOf(method: DiscoveryMethod): JsonObject {
  const { response } = method;
  return {
    '2XX':
      response === undefined
        ? { description: unnamedAnswerOf(method) }
        : { description: response.$ref, content: jsonContentOf(response.$ref) },
  };
}

function operationOf(method: KeptMethod, fields: readonly JsonObject[]): JsonObject {
  return {
    operationId: method.id,
    ...(method.description === undefined ? {} : { description: method.description }),
    ...(method.deprecated === true ? { deprecated: true } : {}),
    parameters: parametersOf(method, fields),
    ...requestBodyOf(method),
    responses: responsesOf(method),
    security: requirementsOf(securitySchemeName, method.scopes),
  };
}

function pathsOf(methods: readonly KeptMethod[], fields: readonly JsonObject[]): JsonObject {
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
    Object.entries(discovery.auth?.oauth2.scopes ?? {})
      .toSorted(byName)
      .map(([scope, { description }]: readonly [string, Required<Described>]): readonly [string, Json] => [
        scope,
        description,
      ]),
  );
}

function infoOf({ name, title, version, description }: DiscoveryDocument): JsonObject {
  return { title: title ?? name, version, ...(description === undefined ? {} : { description }) };
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
    security: rootRequirementOf(securitySchemeName),
    paths: pathsOf(methods, fieldsParameterOf(discovery)),
    components: {
      schemas: componentSchemasOf(discovery, methods),
      securitySchemes: securitySchemesOf(securitySchemeName, server, scopesOf(discovery)),
    },
  };
}

export interface DiscoveryTranslation extends ParameterChanges {
  readonly methods: readonly string[];
  readonly cuts?: readonly Cut[];
}

export interface TranslatedDiscovery {
  readonly document: JsonObject;
  readonly revision: string;
}

export function translatedDiscoveryOf(
  read: unknown,
  metadata: unknown,
  { methods, cuts = [], ...changes }: DiscoveryTranslation,
): TranslatedDiscovery {
  const discovery = discoveryDocumentOf(read);
  const prepared = discoveryParametersChanged(discoveryCut(discovery, cuts), changes);
  const document = curatedDocumentOf(prepared, authorizationServerOf(metadata), methods);
  return { document, revision: discovery.revision };
}
