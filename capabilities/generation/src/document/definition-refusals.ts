import { issueText, type DocumentIssue } from '@on.auto/definitions/document';
import { InvalidInput } from '@on.auto/operations';

export function invalidDefinition(issues: readonly DocumentIssue[]): InvalidInput {
  return new InvalidInput({
    detail: `The generation function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
    issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
  });
}
