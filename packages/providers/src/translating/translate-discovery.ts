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
import { discoveryParametersChanged, type Description, type ParameterChanges } from './discovery-parameters.ts';
import { fieldsParameterOf, parametersOf, pathOf, templated, type Writing } from './discovery-paths.ts';
import { describedOperations, uploadBodyOf, uploadIdOf, uploadPlaceOf, uploadTypeOf } from './discovery-uploads.ts';
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

const securitySchemeName = 'oauth2';

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

function describedAs(operationId: string, method: DiscoveryMethod, { described }: Writing): Described {
  const description = described.get(operationId) ?? method.description;
  return description === undefined ? {} : { description };
}

function operationOf(method: KeptMethod, path: string, writing: Writing): JsonObject {
  return {
    operationId: method.id,
    ...describedAs(method.id, method, writing),
    ...(method.deprecated === true ? { deprecated: true } : {}),
    parameters: parametersOf(method, path, writing),
    ...requestBodyOf(method),
    responses: responsesOf(method),
    security: requirementsOf(securitySchemeName, method.scopes),
  };
}

function uploadOperationOf(method: KeptMethod, discovery: DiscoveryDocument, writing: Writing): Placed {
  const operationId = uploadIdOf(method.id);
  const place = uploadPlaceOf(method);
  const path = templated(place.path);
  return [
    path,
    {
      operationId,
      ...describedAs(operationId, method, writing),
      parameters: parametersOf(method, path, writing, uploadTypeOf(discovery)),
      requestBody: uploadBodyOf(place),
      responses: responsesOf(method),
      security: requirementsOf(securitySchemeName, method.scopes),
    },
  ];
}

type Placed = readonly [string, JsonObject];

function placedOf(method: KeptMethod, uploads: ReadonlySet<string>, discovery: DiscoveryDocument, writing: Writing) {
  const path = pathOf(method, writing.prefix);
  const own: Placed = [path, operationOf(method, path, writing)];
  return uploads.has(method.id) ? [own, uploadOperationOf(method, discovery, writing)] : [own];
}

function pathsOf(
  methods: readonly KeptMethod[],
  uploads: ReadonlySet<string>,
  discovery: DiscoveryDocument,
  writing: Writing,
): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const method of methods) {
    for (const [path, operation] of placedOf(method, uploads, discovery, writing)) {
      paths[path] = { ...paths[path], [method.httpMethod.toLowerCase()]: operation };
    }
  }
  return paths;
}

function uploadsAmong(methods: readonly KeptMethod[], uploads: readonly string[]): ReadonlySet<string> {
  const kept = new Set(methods.map(({ id }) => id));
  const unkept = uploads.filter((id) => !kept.has(id));
  if (unkept.length > 0) {
    throw new Error(`The manifest keeps the upload of ${unkept.join(', ')}, and not the method itself`);
  }
  return new Set(uploads);
}

function operationIdsOf(methods: readonly KeptMethod[], uploads: ReadonlySet<string>): readonly string[] {
  return methods.flatMap(({ id }) => (uploads.has(id) ? [id, uploadIdOf(id)] : [id]));
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

export interface DocumentChanges {
  readonly uploads?: readonly string[];
  readonly descriptions?: readonly Description[];
}

export function curatedDocumentOf(
  discovery: DiscoveryDocument,
  server: AuthorizationServer,
  methodIds: readonly string[],
  { uploads = [], descriptions = [] }: DocumentChanges = {},
): JsonObject {
  const methods = keptMethodsOf(discovery, methodIds);
  const uploading = uploadsAmong(methods, uploads);
  const fromTheRoot = uploading.size > 0;
  const writing: Writing = {
    prefix: fromTheRoot ? discovery.servicePath : '',
    fields: fieldsParameterOf(discovery),
    described: describedOperations(descriptions, operationIdsOf(methods, uploading)),
  };
  const serverUrl = fromTheRoot ? discovery.rootUrl : `${discovery.rootUrl}${discovery.servicePath}`;
  return {
    openapi: fromTheRoot ? '3.2.0' : '3.1.0',
    info: infoOf(discovery),
    ...(discovery.documentationLink === undefined ? {} : { externalDocs: { url: discovery.documentationLink } }),
    servers: [{ url: serverUrl.replace(/\/+$/u, '') }],
    security: rootRequirementOf(securitySchemeName),
    paths: pathsOf(methods, uploading, discovery, writing),
    components: {
      schemas: componentSchemasOf(discovery, methods),
      securitySchemes: securitySchemesOf(securitySchemeName, server, scopesOf(discovery)),
    },
  };
}

export interface DiscoveryTranslation extends ParameterChanges, DocumentChanges {
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
  { methods, cuts = [], uploads, descriptions, ...changes }: DiscoveryTranslation,
): TranslatedDiscovery {
  const discovery = discoveryDocumentOf(read);
  const prepared = discoveryParametersChanged(discoveryCut(discovery, cuts), changes);
  const document = curatedDocumentOf(prepared, authorizationServerOf(metadata), methods, {
    ...(uploads === undefined ? {} : { uploads }),
    ...(descriptions === undefined ? {} : { descriptions }),
  });
  return { document, revision: discovery.revision };
}
