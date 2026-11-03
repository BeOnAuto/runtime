import type { ContentOwner } from '@on.auto/content';
import {
  playbookRowsOf,
  type PlaybookProjectedRow,
  type ProjectionReader,
  type StreamWriter,
  type UnheldContentRemover,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { assetDecider, type AssetCommand } from '../assets/asset-decider.ts';
import { assetStreamIn } from '../assets/asset-keeping.ts';
import { assetRowFrom, assetsName, type AssetRow } from '../assets/asset-projections.ts';

interface ExpiryLedger
  extends StreamWriter, UnheldContentRemover, Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'> {}

export interface ExpiryParts {
  readonly ledger: ExpiryLedger;
}

interface AssetsDueItem {
  readonly key: string;
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void>;
}

export interface AssetsDue {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly AssetsDueItem[]>;
  readonly nextDueAt: (after: number, callsOut?: boolean) => Effect.Effect<number | null>;
}

const byTheRuntime = 'runtime';

const expiringColumn = 'expires_at';

interface Expiring {
  readonly playbook: ContentOwner;
  readonly id: string;
  readonly row: AssetRow;
}

function recorded(
  { ledger }: ExpiryParts,
  { playbook, id }: Expiring,
  event: AssetCommand['event'],
  now: number,
): Effect.Effect<boolean> {
  return ledger
    .execute(assetStreamIn(playbook, id), assetDecider, {
      event,
      context: { at: new Date(now).toISOString(), by: byTheRuntime },
    })
    .pipe(
      Effect.as(true),
      Effect.catchTag('conflict', () => Effect.succeed(false)),
    );
}

function removedOnceUnheld(parts: ExpiryParts, expiring: Expiring, now: number): Effect.Effect<void> {
  const { playbook, row } = expiring;
  return Effect.flatMap(parts.ledger.removeUnheld(playbook, row.sha256), (removal) =>
    removal === 'removed'
      ? Effect.asVoid(
          recorded(
            parts,
            expiring,
            { type: 'asset_content_removed', data: { bytes: row.bytes, sha256: row.sha256 } },
            now,
          ),
        )
      : Effect.void,
  );
}

function expired(parts: ExpiryParts, expiring: Expiring, now: number): Effect.Effect<void> {
  const expiry: AssetCommand['event'] = {
    type: 'asset_expired',
    data: { bytes: expiring.row.bytes },
  };
  return Effect.flatMap(recorded(parts, expiring, expiry, now), (released) =>
    released ? removedOnceUnheld(parts, expiring, now) : Effect.void,
  );
}

function itemOf(parts: ExpiryParts, { org, playbook, key, row }: PlaybookProjectedRow): AssetsDueItem {
  const asset = assetRowFrom(row);
  return {
    key: `${org}/${playbook}/${key}`,
    callsOut: false,
    perform: (now) => Effect.suspend(() => expired(parts, { playbook: { org, playbook }, id: key, row: asset }, now)),
  };
}

const nothingDue: readonly AssetsDueItem[] = [];

export function assetsDue(parts: ExpiryParts): AssetsDue {
  return {
    name: 'the assets whose time is up',
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.succeed(nothingDue)
        : Effect.map(
            parts.ledger.readDueRows(assetsName, { column: expiringColumn, through: now, limit: most }),
            (rows) => playbookRowsOf(assetsName, rows).map((kept) => itemOf(parts, kept)),
          ),
    nextDueAt: (after, callsOut = false) =>
      callsOut ? Effect.succeed(null) : parts.ledger.nextDueOf(assetsName, expiringColumn, after),
  };
}
