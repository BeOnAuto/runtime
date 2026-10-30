import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';
import { Result } from 'effect';

import { checkedFrom, type Checked } from '../document/checked-parts.ts';
import type { WrittenData } from '../document/front-matter.ts';
import type { DataExpression, DataPart, DatasetFilter } from '../document/prediction-document.ts';
import { expressionsOf, filtersOf } from './data-filters.ts';
import { measureIssues } from './data-measures.ts';
import { eventTime, pointerIssues } from './data-pointers.ts';

export interface DataReading {
  readonly data: DataPart;
  readonly expressions: readonly DataExpression[];
}

function projectionIssues(
  { time, series, target }: WrittenData,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  return [
    ...(time === eventTime ? [] : pointerIssues(time, '/data/time', filters, lines)),
    ...pointerIssues(series, '/data/series', filters, lines),
    ...measureIssues(target, '/data/target', filters, lines),
  ];
}

export function dataOf(written: WrittenData, lines: SourceLines): Checked<DataReading> {
  const read = filtersOf(written.events, lines);
  if (Result.isFailure(read)) {
    return Result.fail(read.failure);
  }
  const filters = read.success;
  const { time, series, target, window } = written;
  return checkedFrom(projectionIssues(written, filters, lines), () => ({
    data: { events: filters, time, series, target, window },
    expressions: expressionsOf(filters, lines),
  }));
}
