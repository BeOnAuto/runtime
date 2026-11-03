import type { Finished } from '@on.auto/definitions';
import { uuidV5, type Context } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { assetRowFrom, assetRowOf, assetsName, type AssetRow } from '../assets/asset-projections.ts';
import { addressOf, assetReferenceOf } from '../assets/asset-reference.ts';
import type { Generated } from '../gateway/generation-gateway.ts';
import { finishedAsset, recordOf } from '../run/finished-run.ts';
import type { Waiting, WaitingParts, WaitingPlace } from './waiting-parts.ts';

const waitedAssets = '4d2c8b1e-7f3a-4e6b-9c5d-2a1f0e8b7c63';

export function assetIdOfTheWait(deferredId: string): string {
  return uuidV5(waitedAssets, deferredId);
}

function contextOf({ address, run }: Waiting): Omit<Context, 'at'> {
  return {
    by: run.started_by.id,
    runId: address.id,
    definitionType: 'generation',
    definitionName: run.name,
    definitionVersion: run.definition_version,
  };
}

function finishedFrom(
  parts: WaitingParts,
  { playbook }: WaitingPlace,
  waiting: Waiting,
  kept: AssetRow & { readonly id: string },
) {
  return Effect.map(Clock.currentTimeMillis, (now): Finished => ({
    output: assetReferenceOf(
      { id: kept.id, media_type: kept.media_type, bytes: kept.bytes, sha256: kept.sha256 },
      addressOf(parts.addresses, playbook, kept.sha256, now),
    ),
    record: recordOf(waiting.madeBy, kept.kept_at - Date.parse(waiting.wait.asked_at)),
  }));
}

function keptRowOf(parts: WaitingParts, { playbook, row }: WaitingPlace) {
  return Effect.map(
    parts.ledger.readProjectedRows(assetsName, playbook, {
      where: [{ column: 'row_key', equals: assetIdOfTheWait(row.deferred_id) }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
    ([found]) => found?.row,
  );
}

export function keptBefore(
  parts: WaitingParts,
  place: WaitingPlace,
  waiting: Waiting,
): Effect.Effect<Finished | undefined> {
  const id = assetIdOfTheWait(place.row.deferred_id);
  return Effect.flatMap(keptRowOf(parts, place), (found) => {
    const kept = assetRowOf(found);
    return kept === undefined ? Effect.undefined : finishedFrom(parts, place, waiting, { ...kept, id });
  });
}

function keptByAnother(parts: WaitingParts, place: WaitingPlace, waiting: Waiting): Effect.Effect<Finished> {
  const id = assetIdOfTheWait(place.row.deferred_id);
  return Effect.flatMap(keptRowOf(parts, place), (found) =>
    finishedFrom(parts, place, waiting, { ...assetRowFrom(found), id }),
  );
}

export function keptNow(
  parts: WaitingParts,
  place: WaitingPlace,
  waiting: Waiting,
  generated: Generated,
): Effect.Effect<Finished> {
  return finishedAsset(parts, {
    id: assetIdOfTheWait(place.row.deferred_id),
    playbook: place.playbook,
    generated,
    madeBy: waiting.madeBy,
    keptForMs: waiting.wait.kept_for_ms,
    context: contextOf(waiting),
    lineage: waiting.lineage,
    startedAt: Date.parse(waiting.wait.asked_at),
  }).pipe(Effect.catchTag('conflict', () => keptByAnother(parts, place, waiting)));
}
