import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { refusedAt } from '../document/checked-parts.ts';
import type { DatasetFilter, Measure } from '../document/prediction-document.ts';
import { pointerIssues } from './data-pointers.ts';

export function measureIssues(
  { of, as }: Measure,
  at: string,
  filters: readonly DatasetFilter[],
  lines: SourceLines,
): readonly DocumentIssue[] {
  if (as === 'count') {
    return of === undefined
      ? []
      : refusedAt(lines, `${at}/of`, 'count counts the events and reads no value, so it takes no of');
  }
  return of === undefined
    ? refusedAt(lines, at, `${as} reads a value of each event, so it names where with of, a JSON Pointer into its data`)
    : pointerIssues(of, `${at}/of`, filters, lines);
}
