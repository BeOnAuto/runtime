import { JsonPointer, Result, type Schema } from 'effect';

import { issueAt, type DocumentIssue, type SourceLines } from '../document/document-issue.ts';
import { eventFiltersOf, filterExpressionsOf } from '../document/event-filters.ts';
import { declaredShape } from '../shapes/shape-declarations.ts';
import type { PageData, PageViews } from './page-document.ts';
import type { PageDataFrontMatter } from './page-front-matter.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const pageDataBounds = { mostViews: 8, mostFilters: 8 } as const;

interface DataPlace {
  readonly lines: SourceLines;
  readonly textLineOf: (line: number) => string;
}

const sourceEvents = '/data/source/events';

const viewNamePattern = /^[a-z][a-z0-9_]{0,31}$/u;

const viewNameWords =
  "A view's name is 1 to 32 lowercase letters, digits and underscores, beginning with a letter, so that a template reads it as views.<name>";

const oneLanguage = "The playbook's one language is TypeScript; write the module in TypeScript";

const blockIndicator = /[|>][1-9+-]{0,2}\s*(?:#.*)?$/u;

const exportedAnswer = /^export function answer\b/mu;

function countIssues(views: Readonly<Record<string, Schema.Json>>, lines: SourceLines): readonly DocumentIssue[] {
  const count = Object.keys(views).length;
  const { mostViews } = pageDataBounds;
  return count === 0 || count > mostViews
    ? [issueAt(lines, '/data/views', `data.views names 1 to ${mostViews} views; it names ${count}`)]
    : [];
}

function viewIssues(name: string, shape: Schema.Json, lines: SourceLines): readonly DocumentIssue[] {
  const pointer = `/data/views/${JsonPointer.escapeToken(name)}`;
  const named = viewNamePattern.test(name) ? [] : [issueAt(lines, pointer, viewNameWords)];
  const declared = declaredShape(shape, false);
  return Result.isFailure(declared) ? [...named, issueAt(lines, pointer, declared.failure.detail)] : named;
}

function viewsOf(views: Readonly<Record<string, Schema.Json>>, lines: SourceLines): Checked<PageViews> {
  const issues = [
    ...countIssues(views, lines),
    ...Object.entries(views).flatMap(([name, shape]: readonly [string, Schema.Json]) => viewIssues(name, shape, lines)),
  ];
  const named = Object.entries(views).flatMap(([name, shape]: readonly [string, Schema.Json]) => {
    const declared = declaredShape(shape, false);
    return Result.isSuccess(declared) ? [[name, declared.success.name] as const] : [];
  });
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(Object.fromEntries(named));
}

function languageIssues(language: string, lines: SourceLines): readonly DocumentIssue[] {
  return language === 'typescript' ? [] : [issueAt(lines, '/data/language', oneLanguage)];
}

function foldLineOf(lines: SourceLines, place: DataPlace): number {
  const line = issueAt(lines, '/data/module', '').line;
  return blockIndicator.test(place.textLineOf(line)) ? line + 1 : line;
}

function moduleIssues(module: string, foldLine: number, lines: SourceLines): readonly DocumentIssue[] {
  if (module.trim() === '') {
    return [issueAt(lines, '/data/module', 'data.module holds the TypeScript module that exports fold; it is empty')];
  }
  const answer = exportedAnswer.exec(module);
  return answer === null
    ? []
    : [
        {
          line: foldLine + module.slice(0, answer.index).split('\n').length - 1,
          pointer: '',
          detail: 'The module exports answer, but a page never runs: its module exports fold alone',
        },
      ];
}

export function pageDataOf(data: PageDataFrontMatter, place: DataPlace): Checked<PageData> {
  const { lines } = place;
  const views = viewsOf(data.views, lines);
  const filters = eventFiltersOf(
    data.source.events,
    { pointer: sourceEvents, noun: 'page', most: pageDataBounds.mostFilters },
    lines,
  );
  const foldLine = foldLineOf(lines, place);
  const issues = [
    ...languageIssues(data.language, lines),
    ...(Result.isFailure(views) ? views.failure : []),
    ...(Result.isFailure(filters) ? filters.failure : []),
    ...moduleIssues(data.module, foldLine, lines),
  ];
  if (issues.length > 0 || Result.isFailure(views) || Result.isFailure(filters)) {
    return Result.fail(issues);
  }
  return Result.succeed({
    views: views.success,
    filters: filters.success,
    filterExpressions: filterExpressionsOf(filters.success, sourceEvents, lines),
    fold: data.module,
    foldLine,
  });
}
