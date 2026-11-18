import { Conflict, type ProjectionReader, type PlaybookAddress } from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Effect } from 'effect';

import { assetTotalsName, totalsRowOf } from '../assets/asset-projections.ts';

export type TotalsReading = Pick<ProjectionReader, 'readProjectedRows'>;

const totalsInAPage = 100;

function bytesKeptAfter(
  ledger: TotalsReading,
  playbook: PlaybookAddress,
  { after, kept }: { readonly after?: string; readonly kept: number },
): Effect.Effect<number> {
  const page = { where: [], orderBy: [], order: 'asc', limit: totalsInAPage } as const;
  return Effect.flatMap(
    ledger.readProjectedRows(assetTotalsName, playbook, after === undefined ? page : { ...page, after: [after] }),
    (rows) => {
      const bytes = rows.reduce((sum, { row }) => sum + totalsRowOf(row).bytes, kept);
      const last = rows.at(-1);
      return rows.length === totalsInAPage && last !== undefined
        ? bytesKeptAfter(ledger, playbook, { after: last.key, kept: bytes })
        : Effect.succeed(bytes);
    },
  );
}

function bytesKeptBy(ledger: TotalsReading, playbook: PlaybookAddress): Effect.Effect<number> {
  return bytesKeptAfter(ledger, playbook, { kept: 0 });
}

function full(kept: number, most: number): Conflict {
  return new Conflict({
    detail: `The playbook keeps ${sizeInWords(kept)} of assets, and may keep ${sizeInWords(most)}; an asset makes room as it expires`,
    kind: 'oversized',
  });
}

export function roomLeft(
  ledger: TotalsReading,
  playbook: PlaybookAddress,
  most: number,
): Effect.Effect<void, Conflict> {
  return Effect.flatMap(bytesKeptBy(ledger, playbook), (kept) =>
    kept < most ? Effect.void : Effect.fail(full(kept, most)),
  );
}
