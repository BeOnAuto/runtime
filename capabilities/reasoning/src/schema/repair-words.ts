import { issuesDetail, type SchemaIssue } from '@on.auto/json-schema';

const mostIssuesTold = 5;

const notJson =
  'Your answer is not JSON. Answer again in full, with only a JSON value that matches the schema of the answer, and no other text.';

export function issuesToTell(issues: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return issues.slice(0, mostIssuesTold);
}

export function repairWords(told: readonly SchemaIssue[]): string {
  if (told.length === 0) {
    return notJson;
  }
  const rules = told.map((issue) => issuesDetail([issue], 'answer')).join('\n');
  return `Your answer does not meet these rules of the answer's schema:\n${rules}\n\nAnswer again in full, following every rule.`;
}
