import { issueAt, type DocumentIssue, type SourceLines } from '@on.auto/definitions/document';
import { enclosedBody, literalFilterOf, type LiteralFilterReading } from '@on.auto/workflow-engine/dsl';
import { Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isMapping, type Checked } from '../document/checked-parts.ts';
import type { DataExpression, DatasetFilter } from '../document/prediction-document.ts';

type Rejection = Extract<LiteralFilterReading, { readonly rejections: unknown }>['rejections'][number];

type FilterReading = { readonly filter: DatasetFilter } | { readonly issues: readonly DocumentIssue[] };

const events = '/data/events';

const notAMapping =
  'A filter is a mapping of the attributes an event must have: type, and optionally any other attribute of the event and its data';

function rejectionIssues(
  rejections: readonly Rejection[],
  pointer: string,
  lines: SourceLines,
): readonly DocumentIssue[] {
  return rejections.map(({ pointer: at, detail }) => issueAt(lines, at.replace(`${pointer}/with`, pointer), detail));
}

function filterOf(filter: Schema.Json, index: number, lines: SourceLines): FilterReading {
  const pointer = `${events}/${index}`;
  if (!isMapping(filter)) {
    return { issues: [issueAt(lines, pointer, notAMapping)] };
  }
  const reading = literalFilterOf({ with: filter }, pointer);
  return 'rejections' in reading
    ? { issues: rejectionIssues(reading.rejections, pointer, lines) }
    : { filter: { ...reading.filter.attributes, type: reading.filter.type } };
}

function countIssues(filters: readonly Schema.Json[], lines: SourceLines): readonly DocumentIssue[] {
  const { mostFilters } = predictionBounds;
  if (filters.length === 0) {
    return [issueAt(lines, events, 'A dataset folds the events at least one filter names; it names none')];
  }
  return filters.length > mostFilters
    ? [issueAt(lines, events, `A dataset takes at most ${mostFilters} filters; it names ${filters.length}`)]
    : [];
}

export function filtersOf(filters: readonly Schema.Json[], lines: SourceLines): Checked<readonly DatasetFilter[]> {
  const read: DatasetFilter[] = [];
  const issues: DocumentIssue[] = [...countIssues(filters, lines)];
  for (const [index, filter] of filters.entries()) {
    const reading = filterOf(filter, index, lines);
    if ('issues' in reading) {
      issues.push(...reading.issues);
    } else {
      read.push(reading.filter);
    }
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(read);
}

export function expressionsOf(filters: readonly DatasetFilter[], lines: SourceLines): readonly DataExpression[] {
  return filters.flatMap((filter, index) => {
    const source = enclosedBody(filter['data']);
    const pointer = `${events}/${index}/data`;
    return source === undefined ? [] : [{ source, pointer, line: issueAt(lines, pointer, '').line }];
  });
}
