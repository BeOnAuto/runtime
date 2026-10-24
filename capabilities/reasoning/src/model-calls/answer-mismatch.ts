import type { SchemaIssue } from '@on.auto/json-schema';

export class AnswerMismatch extends Error {
  readonly issues: readonly SchemaIssue[];

  constructor(issues: readonly SchemaIssue[]) {
    super('The answer does not match the output schema');
    this.name = 'AnswerMismatch';
    this.issues = issues;
  }
}
