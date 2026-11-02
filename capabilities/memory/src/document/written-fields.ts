import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { inputVariableIssues, parsedTemplate, templateEngine } from '@on.auto/definitions/template';
import { Result, type Schema } from 'effect';

import type { WrittenText } from './memory-document.ts';

export const memoryEngine = templateEngine();

export type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export interface WrittenPlace {
  readonly lines: SourceLines;
  readonly inputSchema: Schema.JsonObject | undefined;
  readonly organizationKept: boolean;
}

export type LiteralProblem = (text: string) => string | undefined;

export function isLiteral(text: string): boolean {
  return !text.includes('{{') && !text.includes('{%');
}

function literalIssues(text: string, pointer: string, lines: SourceLines, problem: LiteralProblem) {
  const found = isLiteral(text) ? problem(text) : undefined;
  return found === undefined ? [] : [issueAt(lines, pointer, found)];
}

export function writtenText(
  text: string,
  pointer: string,
  { lines, inputSchema }: WrittenPlace,
  problem: LiteralProblem,
): Checked<WrittenText> {
  const line = issueAt(lines, pointer, '').line;
  const atThePointer = (issues: readonly { readonly line: number; readonly detail: string }[]) =>
    issues.map(({ line: at, detail }) => ({ line: at, pointer, detail }));
  return Result.flatMap(Result.mapError(parsedTemplate(memoryEngine, text, line), atThePointer), (template) => {
    const issues = [
      ...atThePointer(template.issues),
      ...atThePointer(inputVariableIssues(template.variables, inputSchema, 'the templates of a memory function')),
      ...literalIssues(text, pointer, lines, problem),
    ];
    return issues.length > 0 ? Result.fail(issues) : Result.succeed({ pointer, template });
  });
}

export function issuesOf(checked: () => Checked<unknown>): readonly DocumentIssue[] {
  const read = checked();
  return Result.isFailure(read) ? read.failure : [];
}

export function issuesAcross(checks: readonly (() => Checked<unknown>)[]): readonly DocumentIssue[] {
  return checks.flatMap((checked) => issuesOf(checked));
}

export function allOf<Item, A>(
  items: readonly Item[],
  check: (item: Item, index: number) => Checked<A>,
): Checked<readonly A[]> {
  const issues = items.flatMap((item, index) => issuesOf(() => check(item, index)));
  return issues.length > 0 ? Result.fail(issues) : Result.all(items.map((item, index) => check(item, index)));
}
