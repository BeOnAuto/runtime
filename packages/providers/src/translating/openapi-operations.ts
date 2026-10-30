import { listed } from '@on.auto/operations';
import { JsonPointer, Option, Schema } from 'effect';

import { isJsonList, isJsonObject } from './discovery-document.ts';
import { requirementsOf } from './oauth2-scheme.ts';
import type { HeldComponents, Reaching } from './openapi-components.ts';
import type { OpenApiScheme, OpenApiTranslation, ScopedScheme } from './openapi-translation.ts';

type Json = Schema.Json;

export type JsonFields = Readonly<Record<string, Json>>;

type Keyword = readonly [string, Json];

export interface Found {
  readonly path: string;
  readonly method: string;
  readonly operation: JsonFields;
  readonly held: HeldComponents;
}

export interface Kept extends Found, Reaching {}

export interface Required {
  readonly kept: Kept;
  readonly scopes: readonly string[];
}

const decodeScopes = Schema.decodeUnknownOption(Schema.Array(Schema.String));

const RequirementsSchema = Schema.Array(Schema.Record(Schema.String, Schema.Array(Schema.String)));

type Requirements = typeof RequirementsSchema.Type;

const decodeRequirements = Schema.decodeUnknownOption(RequirementsSchema);

const decodeParameter = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }));

const decodePlacedParameter = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String, in: Schema.String }));

const vendorExtension = 'x-';

const bodySchema: readonly string[] = ['requestBody', 'content', 'application/json', 'schema'];

const descriptionKeywords: ReadonlySet<string> = new Set(['summary', 'description', 'externalDocs']);

const describedAnswers: JsonFields = { default: { description: 'An answer this document does not describe' } };

export const madeFrom = 'The documents the translation is made from';

export function keptOperation(found: readonly Found[], id: string): Kept {
  const [holding, ...others] = found.filter(({ operation }) => operation['operationId'] === id);
  if (holding === undefined) {
    throw new Error(`${madeFrom} have no operation ${id}`);
  }
  if (others.length > 0) {
    throw new Error(`${madeFrom} hold the operation ${id} ${others.length + 1} times`);
  }
  const { path, method, operation, held } = holding;
  return { path, method, operation, held, id };
}

function valueAt(value: Json | undefined, keys: readonly string[]): Json | undefined {
  const [key, ...inner] = keys;
  if (key === undefined) {
    return value;
  }
  return isJsonObject(value) ? valueAt(value[key], inner) : undefined;
}

function replacedAt(
  value: JsonFields,
  keys: readonly string[],
  replace: (found: JsonFields) => Json,
): Json | undefined {
  const [key, ...inner] = keys;
  if (key === undefined) {
    return replace(value);
  }
  const held = value[key];
  const replaced = isJsonObject(held) ? replacedAt(held, inner, replace) : undefined;
  return replaced === undefined ? undefined : { ...value, [key]: replaced };
}

export function parametersIn(declaring: JsonFields): readonly Json[] {
  const parameters = declaring['parameters'];
  return isJsonList(parameters) ? parameters : [];
}

function parameterNamesOf({ operation }: Found): ReadonlySet<string> {
  return new Set(
    parametersIn(operation).flatMap((parameter) => Option.toArray(decodeParameter(parameter)).map(({ name }) => name)),
  );
}

function placeOf(parameter: Json): string | undefined {
  return Option.getOrUndefined(Option.map(decodePlacedParameter(parameter), (placed) => `${placed.in} ${placed.name}`));
}

export function withParametersOfItsPath(operation: JsonFields, ofItsPath: readonly Json[]): JsonFields {
  if (ofItsPath.length === 0) {
    return operation;
  }
  const own = parametersIn(operation);
  const declared = new Set(own.map((parameter) => placeOf(parameter)));
  const inherited = ofItsPath.filter((parameter) => {
    const place = placeOf(parameter);
    return place === undefined || !declared.has(place);
  });
  return { ...operation, parameters: [...inherited, ...own] };
}

function isNamedIn(parameter: Json, names: ReadonlySet<string>): boolean {
  return Option.exists(decodeParameter(parameter), ({ name }) => names.has(name));
}

function keptNamed(kept: readonly Kept[], id: string, what: string): Kept {
  const named = kept.find((each) => each.id === id);
  if (named === undefined) {
    throw new Error(`The translation ${what} the operation ${id}, which the document does not keep`);
  }
  return named;
}

function leftOutCheckedIn(kept: readonly Kept[], { left_out_parameters: leftOut = [] }: OpenApiTranslation): void {
  for (const { operation, parameters } of leftOut) {
    const held = parameterNamesOf(keptNamed(kept, operation, 'leaves out parameters of'));
    const missing = parameters.filter((name) => !held.has(name));
    if (missing.length > 0) {
      throw new Error(
        `The operation ${operation} has no parameter ${listed(missing)}, which the translation leaves out`,
      );
    }
  }
}

function singleStringsCheckedIn(kept: readonly Kept[], { single_strings: written = [] }: OpenApiTranslation): void {
  for (const { operation } of written) {
    keptNamed(kept, operation, 'writes a schema as one string in');
  }
}

function pathValuesCheckedIn(kept: readonly Kept[], { path_values: pathValues = [] }: OpenApiTranslation): void {
  for (const { parameter } of pathValues) {
    if (!kept.some(({ path }) => path.includes(`{${parameter}}`))) {
      throw new Error(`No path the document keeps holds {${parameter}}, which the translation writes as its value`);
    }
  }
}

function descriptionsCheckedIn(
  kept: readonly Kept[],
  { left_out_descriptions: leftOut = [] }: OpenApiTranslation,
): void {
  for (const id of leftOut.flatMap(({ operations }) => operations)) {
    const { operation } = keptNamed(kept, id, 'leaves out the description of');
    if (!Object.keys(operation).some((keyword) => descriptionKeywords.has(keyword))) {
      throw new Error(
        `The operation ${id} has no summary, description or externalDocs, which the translation leaves out`,
      );
    }
  }
}

export function changesCheckedIn(kept: readonly Kept[], translation: OpenApiTranslation): void {
  leftOutCheckedIn(kept, translation);
  descriptionsCheckedIn(kept, translation);
  singleStringsCheckedIn(kept, translation);
  pathValuesCheckedIn(kept, translation);
}

function scopesRequiredBy(operation: JsonFields, vendorScheme: string): readonly string[] {
  const requirements = Option.getOrElse(decodeRequirements(operation['security']), (): Requirements => []);
  return requirements.flatMap((requirement) => requirement[vendorScheme] ?? []);
}

function listedScopesOf(operation: JsonFields, scheme: ScopedScheme): readonly string[] {
  return scheme.scopes_at === undefined
    ? scopesRequiredBy(operation, scheme.scopes_from_scheme)
    : Option.getOrElse(decodeScopes(valueAt(operation, scheme.scopes_at)), (): readonly string[] => []);
}

function whereListed(scheme: ScopedScheme): string {
  return scheme.scopes_at === undefined
    ? `in its requirement of the scheme ${scheme.scopes_from_scheme}`
    : `under ${scheme.scopes_at.join(' ')}`;
}

export function scopesOf({ id, operation }: Kept, scheme: OpenApiScheme): readonly string[] {
  if (scheme.lists_no_scopes !== undefined) {
    return [];
  }
  const kept = listedScopesOf(operation, scheme).filter(
    (scope) => !scheme.leaving_out.some((ending) => scope.endsWith(ending)),
  );
  if (kept.length === 0) {
    throw new Error(`The operation ${id} lists no scope ${whereListed(scheme)} that the translation keeps`);
  }
  return kept.toSorted();
}

export function writtenPathOf(path: string, { path_values: pathValues = [] }: OpenApiTranslation): string {
  return pathValues.reduce((written, { parameter, value }) => written.replaceAll(`{${parameter}}`, value), path);
}

function leftOutNamesOf({ id, path }: Kept, translation: OpenApiTranslation): ReadonlySet<string> {
  const placed = (translation.path_values ?? []).filter(({ parameter }) => path.includes(`{${parameter}}`));
  const leftOut = (translation.left_out_parameters ?? []).filter(({ operation }) => operation === id);
  return new Set([...placed.map(({ parameter }) => parameter), ...leftOut.flatMap(({ parameters }) => parameters)]);
}

function singleStringOf(schema: JsonFields): Json {
  const description = schema['description'];
  return { type: 'string', ...(typeof description === 'string' ? { description } : {}) };
}

function tokensOf(pointer: string): readonly string[] {
  return pointer
    .slice(1)
    .split('/')
    .map((token) => JsonPointer.unescapeToken(token));
}

function withSingleStrings(operation: JsonFields, { id }: Kept, translation: OpenApiTranslation): JsonFields {
  return (translation.single_strings ?? [])
    .filter((each) => each.operation === id)
    .reduce((written, { at }) => {
      const replaced = replacedAt(written, [...bodySchema, ...tokensOf(at)], singleStringOf);
      if (!isJsonObject(replaced)) {
        throw new Error(`The operation ${id} has no ${at} under the JSON schema of its request body`);
      }
      return replaced;
    }, operation);
}

function writtenKeyword([keyword, value]: Keyword, leftOut: ReadonlySet<string>, keepsResponses: boolean): Keyword {
  if (keyword === 'parameters' && isJsonList(value)) {
    return [keyword, value.filter((parameter) => !isNamedIn(parameter, leftOut))];
  }
  return [keyword, keyword === 'responses' && !keepsResponses ? describedAnswers : value];
}

function leavesOutTheDescriptionOf({ id }: Kept, { left_out_descriptions: leftOut = [] }: OpenApiTranslation): boolean {
  return leftOut.some(({ operations }) => operations.includes(id));
}

function isCopied(keyword: string, leavesOutTheDescription: boolean): boolean {
  return (
    !keyword.startsWith(vendorExtension) &&
    keyword !== 'security' &&
    !(leavesOutTheDescription && descriptionKeywords.has(keyword))
  );
}

export function translatedOperation({ kept, scopes }: Required, translation: OpenApiTranslation): JsonFields {
  const leftOut = leftOutNamesOf(kept, translation);
  const leavesOutTheDescription = leavesOutTheDescriptionOf(kept, translation);
  const copied: JsonFields = Object.fromEntries(
    Object.entries(kept.operation)
      .filter(([keyword]: Keyword) => isCopied(keyword, leavesOutTheDescription))
      .map((each: Keyword) => writtenKeyword(each, leftOut, translation.keeps_responses)),
  );
  const security = scopes.length === 0 ? {} : { security: requirementsOf(translation.scheme.name, scopes) };
  return { ...withSingleStrings(copied, kept, translation), ...security };
}
