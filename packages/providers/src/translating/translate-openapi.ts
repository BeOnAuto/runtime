import { alternatives } from '@on.auto/operations';
import { Schema } from 'effect';

import { isJsonObject } from './discovery-document.ts';
import { authorizationServerOf, rootRequirementOf, securitySchemesOf } from './oauth2-scheme.ts';
import { componentsReachedBy, heldComponentsOf, withMappingsHeld, type Reaching } from './openapi-components.ts';
import {
  changesCheckedIn,
  keptOperation,
  madeFrom,
  parametersIn,
  scopesOf,
  translatedOperation,
  withParametersOfItsPath,
  writtenPathOf,
  type Found,
  type JsonFields,
  type Kept,
  type Required,
} from './openapi-operations.ts';
import type { OpenApiTranslation } from './openapi-translation.ts';

type Json = Schema.Json;

type Keyword = readonly [string, Json];

const SourceSchema = Schema.Struct({
  openapi: Schema.String,
  servers: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Json))),
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Json)),
  components: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Json))),
});

type Source = typeof SourceSchema.Type;

type Sources = readonly [Source, ...Source[]];

interface Translated {
  readonly kept: Kept;
  readonly operation: JsonFields;
}

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const methods: ReadonlySet<string> = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function operationsIn({ paths, components = {} }: Source): readonly Found[] {
  const held = heldComponentsOf(components);
  return Object.entries(paths).flatMap(([path, item]: readonly [string, JsonFields]) => {
    const ofItsPath = parametersIn(item);
    return Object.entries(item).flatMap(([method, operation]: Keyword): readonly Found[] =>
      methods.has(method) && isJsonObject(operation)
        ? [{ path, method, operation: withParametersOfItsPath(operation, ofItsPath), held }]
        : [],
    );
  });
}

function agreedOf<A>(first: A, others: readonly A[], what: string, writtenOf: (value: A) => string): A {
  const written = [...new Set([first, ...others].map((value) => writtenOf(value)))];
  if (written.length > 1) {
    throw new Error(`${madeFrom} name ${what} ${alternatives(written)}, where the document made from them names one`);
  }
  return first;
}

function serversIn({ servers = [] }: Source): readonly JsonFields[] {
  return servers;
}

function serversOf([first, ...others]: Sources): JsonFields {
  const servers = agreedOf(
    serversIn(first),
    others.map((source) => serversIn(source)),
    'the servers',
    (each) => JSON.stringify(each),
  );
  return servers.length === 0 ? {} : { servers };
}

function versionOf([first, ...others]: Sources): string {
  return agreedOf(
    first.openapi,
    others.map(({ openapi }) => openapi),
    'the versions of OpenAPI',
    (version) => version,
  );
}

function sourcesOf(documents: readonly unknown[]): Sources {
  const [first, ...others] = documents.map((document) => decodeSource(document));
  if (first === undefined) {
    throw new Error('The translation is made from no document');
  }
  return [first, ...others];
}

function pathsOf(translated: readonly Translated[], translation: OpenApiTranslation): JsonFields {
  const paths: Record<string, JsonFields> = {};
  for (const { kept, operation } of translated) {
    const path = writtenPathOf(kept.path, translation);
    const methodsThere: JsonFields = paths[path] ?? {};
    paths[path] = { ...methodsThere, [kept.method]: operation };
  }
  return paths;
}

function scopesNamedIn(required: readonly Required[]): JsonFields {
  const scopes = [...new Set(required.flatMap(({ scopes: each }) => each))].toSorted();
  return Object.fromEntries(scopes.map((scope): Keyword => [scope, scope]));
}

export function curatedOpenApiOf(
  documents: readonly unknown[],
  translation: OpenApiTranslation,
  metadata: unknown,
): JsonFields {
  const server = authorizationServerOf(metadata);
  const sources = sourcesOf(documents);
  const found = sources.flatMap((source) => operationsIn(source));
  const kept = translation.operations.map((id) => keptOperation(found, id));
  changesCheckedIn(kept, translation);
  const required = kept.map((each): Required => ({ kept: each, scopes: scopesOf(each, translation.scheme) }));
  const translated = required.map((each): Translated => ({
    kept: each.kept,
    operation: translatedOperation(each, translation),
  }));
  const reaching = translated.map(({ kept: { id, held }, operation }): Reaching => ({ id, held, operation }));
  const components = componentsReachedBy(reaching);
  const holding = heldComponentsOf(components);
  const written = translated.map(({ kept: each, operation }): Translated => ({
    kept: each,
    operation: withMappingsHeld(operation, holding),
  }));
  const servers: JsonFields = serversOf(sources);
  const { name } = translation.scheme;
  return {
    openapi: versionOf(sources),
    info: translation.info,
    ...servers,
    security: rootRequirementOf(name),
    paths: pathsOf(written, translation),
    components: { ...components, securitySchemes: securitySchemesOf(name, server, scopesNamedIn(required)) },
  };
}
