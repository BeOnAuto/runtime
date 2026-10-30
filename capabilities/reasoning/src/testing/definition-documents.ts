import { issueText } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { parseDefinitionDocument } from '../definition/definition-parsing.ts';
import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';

export const reasoningExample = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes an account',
  'config: {max_output_tokens: 800, temperature: 0.2}',
  'input:',
  '  schema: {type: object, properties: {account: {type: string}}, required: [account]}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {summary: {type: string}}, required: [summary], additionalProperties: false}',
  '---',
  '{% system %}You write for a sales team.{% endsystem %}',
  'Summarize {{ input.account }} as of {{ today }}.',
].join('\n');

export function documentOf(frontMatter: string, body = 'Summarize {{ input.text }}'): string {
  return `---\n${frontMatter}\n---\n${body}`;
}

export function parsed(source: string): ReasoningFunctionDefinitionDocument {
  return Result.getOrThrow(parseDefinitionDocument(source));
}

export function issuesIn(source: string): readonly string[] {
  return Result.match(parseDefinitionDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map((issue) => issueText(issue)),
  });
}
