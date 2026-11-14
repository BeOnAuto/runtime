import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';

export function rowFoldedOf(
  projection: KeyedProjection,
  messages: readonly ProjectedMessage[],
): ProjectedRow | undefined {
  let row: ProjectedRow | undefined;
  for (const message of messages) {
    row = projection.rowAfter(row, message) ?? row;
  }
  return row;
}
