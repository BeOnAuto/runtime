import { JsonPointer, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import type { FileProblem } from './file-problem.ts';

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

export type References = 'resolved' | 'kept';

export interface FileSetting {
  readonly setting: string;
  readonly key: string;
  readonly schema: Schema.Top;
  readonly references: References;
  readonly sortsOfCredential: readonly string[];
  readonly prose: readonly string[];
  readonly judgedByShape: readonly string[];
  readonly written: (value: unknown) => Result.Result<string, readonly FileProblem[]>;
}

export interface FileSettingOptions {
  readonly references?: References;
  readonly sortsOfCredential?: readonly string[];
  readonly prose?: readonly string[];
  readonly judgedByShape?: readonly string[];
}

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function pointerOf(path: readonly PathSegment[]): string {
  return path
    .filter((segment) => isPropertyKey(segment))
    .map((segment) => `/${JsonPointer.escapeToken(String(segment))}`)
    .join('');
}

function problemsOf({ issue }: { readonly issue: SchemaIssue.Issue }): readonly FileProblem[] {
  return formatIssues(issue).issues.map(({ message, path = [] }) => ({
    pointer: pointerOf(path),
    detail: message,
  }));
}

export function fileSetting<S extends Schema.Codec<unknown, unknown>>(
  setting: string,
  schema: S,
  written: (value: S['Type']) => string,
  { references = 'resolved', sortsOfCredential = [], prose = [], judgedByShape = [] }: FileSettingOptions = {},
): FileSetting {
  const decode = Schema.decodeUnknownResult(schema, { errors: 'all', onExcessProperty: 'error' });
  return {
    setting,
    key: setting.toLowerCase(),
    schema,
    references,
    sortsOfCredential,
    prose,
    judgedByShape,
    written: (value) => Result.mapBoth(decode(value), { onSuccess: written, onFailure: problemsOf }),
  };
}
