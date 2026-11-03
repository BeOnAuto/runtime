import { Conflict, type Context, type Decider } from '@on.auto/operations';
import { Result } from 'effect';

import { AssetEventSchema, type AssetEvent, type DecidedAssetEvent } from './asset-facts.ts';

export type AssetStanding = 'none' | 'kept' | 'expired' | 'removed';

export interface AssetCommand {
  readonly event: DecidedAssetEvent;
  readonly context: Context;
}

const takes: Readonly<Record<AssetStanding, AssetEvent['type'] | undefined>> = {
  none: 'asset_kept',
  kept: 'asset_expired',
  expired: 'asset_content_removed',
  removed: undefined,
};

const standingAfter: Readonly<Record<AssetEvent['type'], AssetStanding>> = {
  asset_kept: 'kept',
  asset_expired: 'expired',
  asset_content_removed: 'removed',
};

const outOfTurn = new Conflict({
  detail: 'An asset is kept once, expires once and has its content removed once, so this is not recorded',
  kind: 'concurrent_change',
});

export const assetDecider: Decider<AssetStanding, AssetCommand, AssetEvent, 'conflict'> = {
  initialState: 'none',
  evolve: (_standing, { type }) => standingAfter[type],
  decide: ({ event }, standing) => (takes[standing] === event.type ? Result.succeed([event]) : Result.fail(outOfTurn)),
  context: ({ context }) => context,
  eventSchema: AssetEventSchema,
};
