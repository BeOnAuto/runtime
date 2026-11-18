import type { ProjectedAddress, ProjectedKeyedRow } from './keyed-projection.ts';

export interface PlaybookProjectedRow extends ProjectedKeyedRow {
  readonly playbook: string;
}

export function playbookRowsOf(
  projection: string,
  rows: readonly ProjectedKeyedRow[],
): readonly PlaybookProjectedRow[] {
  return rows.map(({ playbook, ...kept }) => {
    if (playbook === undefined) {
      throw new Error(
        `The projection ${projection} folds a playbook's streams alone, yet its row ${kept.key} names the org ${kept.org} and no playbook`,
      );
    }
    return { ...kept, playbook };
  });
}

export function addressOfTheRow({ org, playbook, definition }: ProjectedAddress): ProjectedAddress {
  return definition === undefined ? { org, ...(playbook === undefined ? {} : { playbook }) } : { org, definition };
}
