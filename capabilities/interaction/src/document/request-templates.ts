import type { DocumentIssue } from '@on.auto/definitions/document';
import { inputVariableIssues, parsedTemplate, type ParsedTemplate } from '@on.auto/definitions/template';
import { toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { Result, type Schema } from 'effect';

export interface TemplatePlace {
  readonly line: number;
  readonly pointer: string;
  readonly what: string;
}

export function compiledTemplate(
  text: string,
  { line, pointer, what }: TemplatePlace,
  inputSchema: Schema.JsonObject | undefined,
): Result.Result<ParsedTemplate, readonly DocumentIssue[]> {
  return Result.flatMap(
    Result.mapError(parsedTemplate(toolBlockEngine, text, line), (issues) =>
      issues.map(({ line: at, detail }) => ({ line: at, pointer, detail })),
    ),
    (parsed) => {
      const issues = [
        ...parsed.issues.map(({ line: at, detail }) => ({ line: at, pointer, detail })),
        ...inputVariableIssues(parsed.variables, inputSchema, what).map(({ line: at, detail }) => ({
          line: at,
          pointer,
          detail,
        })),
      ];
      return issues.length > 0 ? Result.fail(issues) : Result.succeed(parsed);
    },
  );
}
