import { Result } from 'effect';

import type { SchemaIssue } from '../document/json-bounds.ts';
import { compileJsonSchema, type Validation } from '../document/json-schema.ts';

export type SchemaCheck = (value: unknown) => readonly SchemaIssue[];

const mostIssuesInADetail = 3;

function firstIssues(found: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return found.slice(0, mostIssuesInADetail);
}

export function schemaCheckOf(schema: unknown, validation: Validation): SchemaCheck {
  return Result.match(compileJsonSchema(schema, validation), {
    onFailure: (found) => () => firstIssues(found),
    onSuccess:
      ({ validate }) =>
      (value) =>
        Result.match(validate(value), { onFailure: firstIssues, onSuccess: () => [] }),
  });
}

export function issuesDetail(issues: readonly SchemaIssue[], what: string): string {
  return issues.map(({ pointer, detail }) => `${pointer === '' ? `the ${what}` : pointer}: ${detail}`).join('; ');
}
