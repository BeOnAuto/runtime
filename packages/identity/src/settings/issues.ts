import { SchemaIssue, type StandardSchema } from 'effect';

type Failure = StandardSchema.StandardSchemaV1.FailureResult;

type IssuePath = StandardSchema.StandardSchemaV1.Issue['path'];

export const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

function keysOf(path: IssuePath): readonly PropertyKey[] {
  return (path ?? []).map((segment) => (typeof segment === 'object' ? segment.key : segment));
}

export function describeIssues({ issues }: Failure, subjectOf: (keys: readonly PropertyKey[]) => string): string {
  return issues.map(({ message, path }) => `${subjectOf(keysOf(path))}: ${message}`).join('; ');
}

export function within(setting: string): (keys: readonly PropertyKey[]) => string {
  return (keys) =>
    `${setting}${keys.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('')}`;
}
