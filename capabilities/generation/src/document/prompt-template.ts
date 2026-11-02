import type { DocumentIssue, DocumentParts } from '@on.auto/definitions/document';
import {
  inputVariableIssues,
  parsedTemplate,
  templateEngine,
  type ParsedTemplate,
} from '@on.auto/definitions/template';
import { Result, type Schema } from 'effect';

export const generationEngine = templateEngine();

const noPrompt = 'The definition has no prompt: write it after the front matter';

const promptWhat = 'the prompt of a generation function';

export function promptOf(
  { body, bodyLine }: Pick<DocumentParts, 'body' | 'bodyLine'>,
  inputSchema?: Schema.JsonObject,
): Result.Result<ParsedTemplate, readonly DocumentIssue[]> {
  if (body.trim() === '') {
    return Result.fail([{ line: bodyLine, pointer: '', detail: noPrompt }]);
  }
  return Result.flatMap(
    Result.mapError(parsedTemplate(generationEngine, body, bodyLine), (issues) =>
      issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
    ),
    (parsed) => {
      const issues = [
        ...parsed.issues.map(({ line, detail }) => ({ line, pointer: '', detail })),
        ...inputVariableIssues(parsed.variables, inputSchema, promptWhat),
      ];
      return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
    },
  );
}
