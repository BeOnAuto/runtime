import { linesOf, parsedTemplate } from '@on.auto/definitions/template';
import { Result } from 'effect';

import type { CompiledTemplate, TemplateIssue } from './compiled-template.ts';
import { engine } from './liquid-engine.ts';
import { markerIssues, outlineOf } from './system-block.ts';
import { renderTemplate } from './template-rendering.ts';

export function compileTemplate(
  body: string,
  firstLine: number,
): Result.Result<CompiledTemplate, readonly TemplateIssue[]> {
  const parsing = parsedTemplate(engine, body, firstLine);
  if (Result.isFailure(parsing)) {
    return Result.fail(parsing.failure);
  }
  const parsed = parsing.success;
  const outline = outlineOf(parsed.templates, linesOf(body, firstLine));
  const issues = [...markerIssues(outline), ...parsed.issues];
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  const hasInstructions = outline.top.length > 0;
  return Result.succeed({
    text: body,
    firstLine,
    hasInstructions,
    hasMessage: outline.hasMessage,
    variables: parsed.variables,
    render: (scope) => renderTemplate(parsed, hasInstructions, scope),
  });
}
