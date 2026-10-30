import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { Predicate, Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';

export type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

export function issuesOf(check: () => Checked<unknown>): readonly DocumentIssue[] {
  const checked = check();
  return Result.isFailure(checked) ? checked.failure : [];
}

export function refusedAt(lines: SourceLines, pointer: string, detail: string): readonly DocumentIssue[] {
  return [issueAt(lines, pointer, detail)];
}

export function checkedFrom<A>(issues: readonly DocumentIssue[], value: () => A): Checked<A> {
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(value());
}

export function isWhole(value: number, least: number, most: number): boolean {
  return Number.isInteger(value) && value >= least && value <= most;
}

const namePattern = /^[a-z][a-z0-9_]*$/u;

const headerNames: ReadonlySet<string> = new Set(['series', 'period']);

export function nameIssues(name: string, lines: SourceLines, pointer: string): readonly DocumentIssue[] {
  if (!namePattern.test(name) || name.length > predictionBounds.mostNameCharacters) {
    return refusedAt(
      lines,
      pointer,
      `${name} is not a name a dataset's column takes: 1 to ${predictionBounds.mostNameCharacters} lowercase letters, digits and underscores, starting with a letter`,
    );
  }
  return headerNames.has(name)
    ? refusedAt(lines, pointer, `${name} is a column every dataset row already has; name the quantity otherwise`)
    : [];
}

export function isMapping(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}
