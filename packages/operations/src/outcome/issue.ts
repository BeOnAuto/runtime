import { Schema } from 'effect';

export interface Issue {
  readonly detail: string;
  readonly pointer: string;
}

const mostIssues = 100;

export function cappedIssues(issues: readonly Issue[]): readonly Issue[] {
  return issues.slice(0, mostIssues).map(({ detail, pointer }) => ({ detail, pointer }));
}

export const IssueSchema = Schema.Struct({
  detail: Schema.String.annotate({ description: 'What is wrong' }),
  pointer: Schema.String.annotate({ description: 'A JSON Pointer to the part of the input that is wrong' }),
});
