import type { ProjectedRow } from '../projections/keyed-projection.ts';
import type { GroupwiseMaximum } from './stream-projection.ts';

function groupOf(columns: readonly string[], row: ProjectedRow): string {
  return JSON.stringify(columns.map((column) => row[column] ?? null));
}

function greatestOfEachGroup(
  { groupedBy, greatest }: GroupwiseMaximum,
  groups: readonly ProjectedRow[],
): ReadonlyMap<string, ProjectedRow> {
  const greatestOf = new Map<string, ProjectedRow>();
  for (const row of groups) {
    const group = groupOf(groupedBy, row);
    const held = greatestOf.get(group);
    if (held === undefined || Number(row[greatest]) > Number(held[greatest])) {
      greatestOf.set(group, row);
    }
  }
  return greatestOf;
}

export function rowsNotOfTheGreatest(
  maximum: GroupwiseMaximum,
  rows: readonly ProjectedRow[],
  groups: readonly ProjectedRow[],
): number {
  const greatestOf = greatestOfEachGroup(maximum, groups);
  return rows.filter((row) => {
    const greatest = greatestOf.get(groupOf(maximum.groupedBy, row));
    return greatest === undefined || maximum.matching.some(({ column, equals }) => row[column] !== greatest[equals]);
  }).length;
}
