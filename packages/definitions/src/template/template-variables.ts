import { Predicate, type Schema } from 'effect';

import type { DocumentIssue } from '../document/document-issue.ts';
import type { VariableReference } from './template-parsing.ts';

const moments: ReadonlyMap<string, string> = new Map([
  ['today', 'the date, as YYYY-MM-DD'],
  ['now', 'the time, in ISO 8601'],
]);

function declaredProperties(schema: Schema.JsonObject | undefined): ReadonlySet<string> | undefined {
  const properties = schema?.['properties'];
  return schema?.['additionalProperties'] === false
    ? new Set(Predicate.isObject(properties) ? Object.keys(properties) : [])
    : undefined;
}

function referenceIssue(
  { path, line }: VariableReference,
  declared: ReadonlySet<string> | undefined,
  what: string,
): DocumentIssue | undefined {
  const [root, property] = path;
  const name = String(root);
  const moment = moments.get(name);
  if (name === 'input') {
    return typeof property === 'string' && declared !== undefined && !declared.has(property)
      ? { line, pointer: '', detail: `input.${property} is not a property of the input schema, which allows no others` }
      : undefined;
  }
  if (moment !== undefined) {
    return path.length > 1 ? { line, pointer: '', detail: `${name} is ${moment}, and has no properties` } : undefined;
  }
  return {
    line,
    pointer: '',
    detail: `${name} is not a variable of ${what}, which reads input, today and now; assign it first`,
  };
}

export function inputVariableIssues(
  variables: readonly VariableReference[],
  inputSchema: Schema.JsonObject | undefined,
  what: string,
): readonly DocumentIssue[] {
  const declared = declaredProperties(inputSchema);
  const issues = variables.flatMap((reference) => {
    const issue = referenceIssue(reference, declared, what);
    return issue === undefined ? [] : [issue];
  });
  return [...new Map(issues.map((issue) => [`${issue.line} ${issue.detail}`, issue])).values()];
}
