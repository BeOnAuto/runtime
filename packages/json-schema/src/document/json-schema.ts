import { JsonSchema, Result, Schema, SchemaRepresentation } from 'effect';

import { withFormatChecks } from './format-checks.ts';
import { foundIssuesOf, type FoundIssue } from './found-issues.ts';
import {
  boundedIssues,
  hiddenIssues,
  mostIssues,
  nestedDeeperThan,
  utf8Bytes,
  type SchemaIssue as Issue,
} from './json-bounds.ts';
import { referenceLoopIssues } from './reference-loops.ts';
import { shapeIssues, type OtherFormats } from './schema-shape.ts';

export const jsonSchemaLimits = {
  bytes: 65_536,
  nesting: 64,
  issues: mostIssues,
} as const;

export interface CompiledSchema {
  readonly document: Schema.JsonObject;
  readonly what: string;
  readonly validate: (value: unknown) => Result.Result<Schema.Json, readonly Issue[]>;
  readonly issuesOf: (value: unknown) => readonly FoundIssue[];
}

export type FurtherCheck = (value: Schema.Json) => readonly Issue[];

export interface Validation {
  readonly what: string;
  readonly nesting: number;
  readonly further?: FurtherCheck;
  readonly otherFormats?: OtherFormats;
}

type Decoder = (input: unknown) => Result.Result<unknown, Schema.SchemaError>;

type Checked = Result.Result<Schema.Json, readonly FoundIssue[]>;

const isJsonObject = Schema.is(Schema.JsonObject);

const isJson = Schema.is(Schema.Json);

const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

const draft07 = 'http://json-schema.org/draft-07/schema';

const issueBounds = {
  keyOf: ({ pointer, detail }: FoundIssue) => `${pointer}\u0000${detail}`,
  hidden: (count: number): FoundIssue => ({ pointer: '', detail: hiddenIssues(count) }),
};

function rootIssue(detail: string): readonly Issue[] {
  return [{ pointer: '', detail }];
}

export function boundedJsonSchema(document: unknown): Result.Result<Schema.JsonObject, readonly Issue[]> {
  if (nestedDeeperThan(document, jsonSchemaLimits.nesting)) {
    return Result.fail(rootIssue(`A schema may nest at most ${jsonSchemaLimits.nesting} levels of objects and lists`));
  }
  if (!isJsonObject(document)) {
    return Result.fail(rootIssue('A schema is a JSON object'));
  }
  return utf8Bytes(JSON.stringify(document)) > jsonSchemaLimits.bytes
    ? Result.fail(rootIssue(`A schema may take at most ${jsonSchemaLimits.bytes} bytes as JSON`))
    : Result.succeed(document);
}

function wellFormedDocument(
  document: Schema.JsonObject,
  otherFormats: OtherFormats | undefined,
): Result.Result<Schema.JsonObject, readonly Issue[]> {
  const issues = [...shapeIssues(document, otherFormats), ...referenceLoopIssues(document)];
  return issues.length > 0 ? Result.fail(boundedIssues(issues, issueBounds)) : Result.succeed(document);
}

function isDraft07(document: Schema.JsonObject): boolean {
  const declared = document['$schema'];
  const draft = typeof declared === 'string' && declared.replace(/#$/u, '') === draft07;
  return draft || (document['definitions'] !== undefined && document['$defs'] === undefined);
}

function importedDocument(document: Schema.JsonObject): JsonSchema.Document<'draft-2020-12'> {
  return isDraft07(document) ? JsonSchema.fromSchemaDraft07(document) : JsonSchema.fromSchemaDraft2020_12(document);
}

function importFailure(error: unknown): string {
  return String(error)
    .replace(/^Error: /u, '')
    .replace(/\n.*$/su, '');
}

function decoderOf(document: Schema.JsonObject): Result.Result<Decoder, readonly Issue[]> {
  try {
    const imported = SchemaRepresentation.fromJsonSchemaDocument(importedDocument(document));
    const asserted = Schema.make<Schema.Codec<unknown>>(withFormatChecks(imported.ast, document));
    return Result.succeed(Schema.decodeUnknownResult(asserted, strictly));
  } catch (error) {
    return Result.fail(rootIssue(importFailure(error)));
  }
}

function nothingFurther(): readonly Issue[] {
  return [];
}

function schemaIssuesOf(decode: Decoder, value: Schema.Json): readonly FoundIssue[] {
  const decoded = decode(value);
  return Result.isSuccess(decoded) ? [] : foundIssuesOf(decoded.failure.issue);
}

function checkerOf(
  decode: Decoder,
  { what, nesting, further = nothingFurther }: Validation,
): (value: unknown) => Checked {
  return (value) => {
    if (nestedDeeperThan(value, nesting)) {
      return Result.fail(rootIssue(`The ${what} nests more than ${nesting} levels`));
    }
    if (!isJson(value)) {
      return Result.fail(rootIssue(`The ${what} is not JSON`));
    }
    const issues = [...schemaIssuesOf(decode, value), ...further(value)];
    return issues.length === 0 ? Result.succeed(value) : Result.fail(boundedIssues(issues, issueBounds));
  };
}

function withoutBreaches(issues: readonly FoundIssue[]): readonly Issue[] {
  return issues.map(({ pointer, detail }) => ({ pointer, detail }));
}

function compiledOf(document: Schema.JsonObject, decode: Decoder, validation: Validation): CompiledSchema {
  const checked = checkerOf(decode, validation);
  return {
    document,
    what: validation.what,
    validate: (value) => Result.mapError(checked(value), withoutBreaches),
    issuesOf: (value) => Result.match(checked(value), { onSuccess: () => [], onFailure: (issues) => issues }),
  };
}

export function compileJsonSchema(
  document: unknown,
  validation: Validation,
): Result.Result<CompiledSchema, readonly Issue[]> {
  return boundedJsonSchema(document).pipe(
    Result.flatMap((bounded) => wellFormedDocument(bounded, validation.otherFormats)),
    Result.flatMap((usable) => Result.map(decoderOf(usable), (decode) => compiledOf(usable, decode, validation))),
  );
}
