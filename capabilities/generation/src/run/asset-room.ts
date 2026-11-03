import type { ContentOwner } from '@on.auto/content';
import { Conflict, type ProjectionReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { assetTotalsName, rowKeyed, totalsKey, totalsRowOf } from '../assets/asset-projections.ts';
import { sizeInWords } from '../assets/asset-words.ts';

export type TotalsReading = Pick<ProjectionReader, 'readProjectedRows'>;

function bytesKeptBy(ledger: TotalsReading, playbook: ContentOwner): Effect.Effect<number> {
  return Effect.map(
    ledger.readProjectedRows(assetTotalsName, playbook, rowKeyed(totalsKey)),
    ([kept]) => totalsRowOf(kept?.row).bytes,
  );
}

function full(kept: number, most: number): Conflict {
  return new Conflict({
    detail: `The playbook keeps ${sizeInWords(kept)} of assets, and may keep ${sizeInWords(most)}; an asset makes room as it expires`,
    kind: 'oversized',
  });
}

export function roomLeft(ledger: TotalsReading, playbook: ContentOwner, most: number): Effect.Effect<void, Conflict> {
  return Effect.flatMap(bytesKeptBy(ledger, playbook), (kept) =>
    kept < most ? Effect.void : Effect.fail(full(kept, most)),
  );
}
