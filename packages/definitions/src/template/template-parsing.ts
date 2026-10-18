import { Result } from 'effect';
import type { StaticAnalysis, Template } from 'liquidjs';

import { engineFailureOf } from './engine-failure.ts';
import { templateLimits, type TemplateEngine } from './template-engine.ts';

export interface TemplateIssue {
  readonly line: number;
  readonly detail: string;
}

export type VariableSegment = string | number | null;

export interface VariableReference {
  readonly path: readonly VariableSegment[];
  readonly line: number;
}

export interface ParsedTemplate {
  readonly templates: () => Template[];
  readonly variables: readonly VariableReference[];
  readonly issues: readonly TemplateIssue[];
  readonly text: string;
  readonly firstLine: number;
}

const clearerMessages: ReadonlyMap<string, string> = new Map([
  [
    'AssertionError: parse length limit exceeded',
    `A template may take at most ${templateLimits.characters} characters`,
  ],
]);

const tooDeep = 'The tags or parentheses of the template nest too deeply to be read';

function parsedTemplates(
  engine: TemplateEngine,
  body: string,
  firstLine: number,
): Result.Result<Template[], readonly TemplateIssue[]> {
  try {
    return Result.succeed(engine.parse(body));
  } catch (error) {
    const { line, message, cause } = engineFailureOf(error, firstLine);
    const detail = cause instanceof RangeError ? tooDeep : (clearerMessages.get(message) ?? message);
    return Result.fail([{ line, detail }]);
  }
}

function nameIssues(engine: TemplateEngine, body: string, firstLine: number): readonly TemplateIssue[] {
  const names = engine.namesIn(body);
  return names > templateLimits.names
    ? [
        {
          line: firstLine,
          detail: `A template may use at most ${templateLimits.names} names in its tags and outputs (variables, properties, filters and keywords); this one uses ${names}`,
        },
      ]
    : [];
}

function variableReferences(analysis: () => StaticAnalysis, firstLine: number): readonly VariableReference[] {
  const references: VariableReference[] = [];
  for (const variables of Object.values(analysis().globals)) {
    for (const variable of variables) {
      const path: VariableSegment[] = [];
      for (const segment of variable.segments) {
        path.push(typeof segment === 'object' ? null : segment);
      }
      references.push({ path, line: firstLine + variable.location.row - 1 });
    }
  }
  return references.toSorted((first, second) => first.line - second.line);
}

export function parsedTemplate(
  engine: TemplateEngine,
  body: string,
  firstLine: number,
): Result.Result<ParsedTemplate, readonly TemplateIssue[]> {
  const parsing = parsedTemplates(engine, body, firstLine);
  if (Result.isFailure(parsing)) {
    return Result.fail(parsing.failure);
  }
  const templates = parsing.success;
  return Result.succeed({
    templates: () => templates,
    variables: variableReferences(() => engine.analyze(() => templates), firstLine),
    issues: nameIssues(engine, body, firstLine),
    text: body,
    firstLine,
  });
}
