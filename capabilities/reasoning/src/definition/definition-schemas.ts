import { declaredShape, type OutputShape } from '@on.auto/definitions';
import { issueAt, issueText, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { type SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import type { OutputRequest } from '../model/model-request.ts';
import {
  checkAnswerSchema,
  compileAnswerSchema,
  compileInputSchema,
  shapedAnswerSchema,
} from '../schema/answer-schema.ts';
import type { InputSection, OutputSection } from './front-matter-schema.ts';
import type { InputContract } from './reasoning-function-definition.ts';

export interface OutputContract {
  readonly output: OutputRequest;
  readonly warnings: readonly string[];
}

const mostWarnings = 100;

const missingKey = 'Missing key';

const shapedText = 'An output that names a shape is JSON of that shape: leave format out, or set it to json';

function issuesUnder(lines: SourceLines, at: string, issues: readonly SchemaIssue[]): readonly DocumentIssue[] {
  return issues.map(({ pointer, detail }) => issueAt(lines, `${at}${pointer}`, detail));
}

function isRequiredAtRoot({ pointer, detail }: SchemaIssue): boolean {
  return detail === missingKey && pointer.lastIndexOf('/') === 0;
}

function defaultsIssues(
  validate: (value: unknown) => Result.Result<Schema.Json, readonly SchemaIssue[]>,
  defaults: Schema.JsonObject,
  lines: SourceLines,
): readonly DocumentIssue[] {
  const issues = Result.match(validate(defaults), { onSuccess: () => [], onFailure: (found) => found });
  return issuesUnder(
    lines,
    '/input/default',
    issues.filter((issue) => !isRequiredAtRoot(issue)),
  );
}

export function inputContractOf(
  section: InputSection,
  lines: SourceLines,
): Result.Result<InputContract, readonly DocumentIssue[]> {
  const { schema: document, default: defaults = {} } = section ?? {};
  if (document === undefined) {
    return Result.succeed({ defaults });
  }
  const compiled = compileInputSchema(document);
  if (document['type'] !== 'object') {
    return Result.fail([
      issueAt(lines, '/input/schema', 'The input schema describes an object: its root has "type": "object"'),
      ...(Result.isFailure(compiled) ? issuesUnder(lines, '/input/schema', compiled.failure) : []),
    ]);
  }
  if (Result.isFailure(compiled)) {
    return Result.fail(issuesUnder(lines, '/input/schema', compiled.failure));
  }
  const issues = defaultsIssues(compiled.success.validate, defaults, lines);
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ schema: compiled.success, defaults });
}

function warningsOf(document: Schema.JsonObject, lines: SourceLines, at: string): readonly string[] {
  const { not_portable, unchecked } = checkAnswerSchema(document);
  return [
    ...not_portable.map(({ pointer, detail, providers }) =>
      issueAt(lines, `${at}${pointer}`, `${detail} (${providers.join(', ')})`),
    ),
    ...issuesUnder(lines, at, unchecked),
  ]
    .slice(0, mostWarnings)
    .map((issue) => issueText(issue));
}

function shapedContractOf(
  shape: OutputShape,
  format: 'text' | 'json' | undefined,
  lines: SourceLines,
): Result.Result<OutputContract, readonly DocumentIssue[]> {
  return format === 'text'
    ? Result.fail([issueAt(lines, '/output/format', shapedText)])
    : Result.succeed({
        output: { type: 'json', schema: shapedAnswerSchema(shape), shape },
        warnings: warningsOf(shape.schema, lines, '/output/shape'),
      });
}

export function outputContractOf(
  section: OutputSection,
  lines: SourceLines,
): Result.Result<OutputContract, readonly DocumentIssue[]> {
  if (section?.shape === undefined) {
    return writtenContractOf(section, lines);
  }
  const { shape, schema, format } = section;
  return declaredShape(shape, schema !== undefined).pipe(
    Result.mapError(({ at, detail }) => [issueAt(lines, `/output/${at}`, detail)]),
    Result.flatMap((declared) => shapedContractOf(declared, format, lines)),
  );
}

function writtenContractOf(
  section: OutputSection,
  lines: SourceLines,
): Result.Result<OutputContract, readonly DocumentIssue[]> {
  const document = section?.schema;
  if (section?.format !== 'json') {
    return document === undefined
      ? Result.succeed({ output: { type: 'text' }, warnings: [] })
      : Result.fail([
          issueAt(
            lines,
            '/output/schema',
            'A text output takes no schema; set format: json to ask for JSON that matches it',
          ),
        ]);
  }
  if (document === undefined) {
    return Result.fail([issueAt(lines, '/output', 'A json output needs a schema of the answer')]);
  }
  const compiled = compileAnswerSchema(document);
  return Result.isFailure(compiled)
    ? Result.fail(issuesUnder(lines, '/output/schema', compiled.failure))
    : Result.succeed({
        output: { type: 'json', schema: compiled.success },
        warnings: warningsOf(document, lines, '/output/schema'),
      });
}
