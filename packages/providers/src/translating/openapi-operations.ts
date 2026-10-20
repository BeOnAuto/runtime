import { listed } from '@on.auto/operations';
import { JsonPointer, Option, Predicate, Schema } from 'effect';

import { requirementsOf } from './oauth2-scheme.ts';
import type { HeldComponents, Reaching } from './openapi-components.ts';

type Json = Schema.Json;

export type JsonFields = Readonly<Record<string, Json>>;

type Keyword = readonly [string, Json];

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const NamesSchema = Schema.Array(NamedSchema).check(Schema.isMinLength(1));

const ReasonSchema = NamedSchema.annotate({ description: 'Why the translation does so, in words' });

const OperationIdSchema = NamedSchema.annotate({ description: 'The id of an operation the document keeps' });

const PathValueSchema = Schema.Struct({
  parameter: NamedSchema.annotate({
    description: 'The path parameter written as its value in every path, and so no parameter of any operation',
  }),
  value: NamedSchema.annotate({ description: 'The value written in its place' }),
  because: ReasonSchema,
});

const LeftOutParametersSchema = Schema.Struct({
  operation: OperationIdSchema,
  parameters: NamesSchema.annotate({ description: 'The names of the parameters of the operation it leaves out' }),
  because: ReasonSchema,
});

const SingleStringSchema = Schema.Struct({
  operation: OperationIdSchema,
  at: Schema.String.check(Schema.isPattern(/^(?:\/[^/]+)+$/u)).annotate({
    description:
      'A JSON pointer, under the schema of the JSON body of the request, to the schema written as one string with its description',
  }),
  because: ReasonSchema,
});

const schemeFields = {
  name: NamedSchema.annotate({
    description: 'The name of the oauth2 scheme every operation requires, in place of the schemes of its document',
  }),
  leaving_out: Schema.Array(NamedSchema).annotate({
    description: 'The endings of the scopes an operation lists that its requirements leave out',
  }),
  because: ReasonSchema,
};

const ScopesAtSchema = NamesSchema.annotate({
  description: 'The keys, each inside the one before, under which an operation lists its scopes',
});

const ScopesFromSchemeSchema = NamedSchema.annotate({
  description: "The scheme of the vendor's document whose requirement in an operation lists the scopes it needs",
});

const OpenApiSchemeSchema = Schema.Union([
  Schema.Struct({
    ...schemeFields,
    scopes_at: ScopesAtSchema,
    scopes_from_scheme: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    ...schemeFields,
    scopes_from_scheme: ScopesFromSchemeSchema,
    scopes_at: Schema.optionalKey(Schema.Never),
  }),
]);

type OpenApiScheme = typeof OpenApiSchemeSchema.Type;

export const OpenApiTranslationSchema = Schema.Struct({
  info: Schema.Struct({ title: NamedSchema, version: NamedSchema, description: NamedSchema }).annotate({
    description: 'The info of the document made',
  }),
  operations: NamesSchema.annotate({
    description: 'The ids of the operations the document keeps, each copied whole from the document that holds it',
  }),
  path_values: Schema.optionalKey(Schema.Array(PathValueSchema)),
  left_out_parameters: Schema.optionalKey(Schema.Array(LeftOutParametersSchema)),
  single_strings: Schema.optionalKey(Schema.Array(SingleStringSchema)),
  scheme: OpenApiSchemeSchema,
  keeps_responses: Schema.Boolean.annotate({
    description: 'Whether the operations keep the answers their documents describe, or say only that they answer',
  }),
});

export type OpenApiTranslation = typeof OpenApiTranslationSchema.Type;

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

const vendorExtension = 'x-';

const bodySchema: readonly string[] = ['requestBody', 'content', 'application/json', 'schema'];

const describedAnswers: JsonFields = { default: { description: 'An answer this document does not describe' } };

export const madeFrom = 'The documents the translation is made from';

export function isJsonFields(value: Json | undefined): value is JsonFields {
  return Predicate.isObject(value) && !Array.isArray(value);
}

export function isJsonList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

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
  return isJsonFields(value) ? valueAt(value[key], inner) : undefined;
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
  const replaced = isJsonFields(held) ? replacedAt(held, inner, replace) : undefined;
  return replaced === undefined ? undefined : { ...value, [key]: replaced };
}

function parameterNamesOf({ operation }: Found): ReadonlySet<string> {
  const parameters = operation['parameters'];
  const declared = isJsonList(parameters) ? parameters : [];
  return new Set(declared.flatMap((parameter) => Option.toArray(decodeParameter(parameter)).map(({ name }) => name)));
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

export function changesCheckedIn(kept: readonly Kept[], translation: OpenApiTranslation): void {
  leftOutCheckedIn(kept, translation);
  singleStringsCheckedIn(kept, translation);
  pathValuesCheckedIn(kept, translation);
}

function scopesRequiredBy(operation: JsonFields, vendorScheme: string): readonly string[] {
  const requirements = Option.getOrElse(decodeRequirements(operation['security']), (): Requirements => []);
  return requirements.flatMap((requirement) => requirement[vendorScheme] ?? []);
}

function listedScopesOf(operation: JsonFields, scheme: OpenApiScheme): readonly string[] {
  return scheme.scopes_at === undefined
    ? scopesRequiredBy(operation, scheme.scopes_from_scheme)
    : Option.getOrElse(decodeScopes(valueAt(operation, scheme.scopes_at)), (): readonly string[] => []);
}

function whereListed(scheme: OpenApiScheme): string {
  return scheme.scopes_at === undefined
    ? `in its requirement of the scheme ${scheme.scopes_from_scheme}`
    : `under ${scheme.scopes_at.join(' ')}`;
}

export function scopesOf({ id, operation }: Kept, scheme: OpenApiScheme): readonly string[] {
  const kept = listedScopesOf(operation, scheme).filter(
    (scope) => !scheme.leaving_out.some((ending) => scope.endsWith(ending)),
  );
  if (kept.length === 0) {
    throw new Error(`The operation ${id} lists no scope ${whereListed(scheme)} that the translation keeps`);
  }
  return kept;
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
      if (!isJsonFields(replaced)) {
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

export function translatedOperation({ kept, scopes }: Required, translation: OpenApiTranslation): JsonFields {
  const leftOut = leftOutNamesOf(kept, translation);
  const copied: JsonFields = Object.fromEntries(
    Object.entries(kept.operation)
      .filter(([keyword]: Keyword) => !keyword.startsWith(vendorExtension) && keyword !== 'security')
      .map((each: Keyword) => writtenKeyword(each, leftOut, translation.keeps_responses)),
  );
  const security = requirementsOf(translation.scheme.name, scopes);
  return { ...withSingleStrings(copied, kept, translation), security };
}
