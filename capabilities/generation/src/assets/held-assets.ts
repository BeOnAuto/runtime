import type { RecordedContent } from '@on.auto/content';
import {
  assetContentOf,
  assetUnusable,
  type AssetHolding,
  type AssetReference,
  type AssetUnusable,
  type HeldAsset,
  type PlaybookAddress,
  type ProjectionReader,
} from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { assetRowOf, assetsName, hasExpired, rowKeyed, type AssetRow } from './asset-projections.ts';

export interface AssetReading {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'>;
  readonly content: Pick<RecordedContent, 'get' | 'getHead'>;
}

function rowOf(reading: AssetReading, playbook: PlaybookAddress, id: string): Effect.Effect<AssetRow | undefined> {
  return Effect.map(reading.ledger.readProjectedRows(assetsName, playbook, rowKeyed(id)), ([kept]) =>
    assetRowOf(kept?.row),
  );
}

function usableRow(row: AssetRow | undefined, reference: AssetReference, now: number): AssetRow | AssetUnusable {
  if (row === undefined) {
    return assetUnusable('not_kept', reference);
  }
  if (row.sha256 !== reference.sha256) {
    return assetUnusable('other_bytes', reference);
  }
  return hasExpired(row, now) ? assetUnusable('expired', reference) : row;
}

function openedIn(reading: AssetReading, playbook: PlaybookAddress, reference: AssetReference) {
  return () =>
    Effect.flatMap(reading.content.get(playbook, reference.sha256), (content) =>
      content === undefined ? Effect.fail(assetUnusable('content_gone', reference)) : Effect.succeed(content.stream),
    );
}

function heldIn(reading: AssetReading, playbook: PlaybookAddress, reference: AssetReference) {
  return Effect.gen(function* () {
    const row = usableRow(yield* rowOf(reading, playbook, reference.id), reference, yield* Clock.currentTimeMillis);
    if ('detail' in row) {
      return yield* Effect.fail(row);
    }
    const head = yield* reading.content.getHead(playbook, row.sha256);
    if (head === undefined || head.erasedAt !== undefined) {
      return yield* Effect.fail(assetUnusable('content_gone', reference));
    }
    const held: HeldAsset = {
      id: reference.id,
      mediaType: row.media_type,
      bytes: row.bytes,
      sha256: row.sha256,
      content: assetContentOf(row.media_type),
      opened: openedIn(reading, playbook, reference),
    };
    return held;
  });
}

export function assetsHeld(reading: AssetReading): AssetHolding {
  return { held: (playbook, reference) => heldIn(reading, playbook, reference) };
}
