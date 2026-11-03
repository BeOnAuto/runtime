import { contentOfBytes, type ContentOwner, type RecordedContent } from '@on.auto/content';
import {
  streamPrefixOfPlaybook,
  type Conflict,
  type Context,
  type Lineage,
  type StreamWriter,
} from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { assetDecider } from './asset-decider.ts';
import { assetStreamOf, type AssetKeptData } from './asset-facts.ts';
import type { KeptAsset } from './asset-reference.ts';

export type MadeBy = Omit<AssetKeptData, 'media_type' | 'bytes' | 'sha256' | 'expires_at'>;

export interface AssetToKeep {
  readonly id: string;
  readonly playbook: ContentOwner;
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
  readonly madeBy: MadeBy;
  readonly keptForMs: number;
  readonly context: Omit<Context, 'at'>;
  readonly lineage: Lineage;
}

export interface AssetKeeping {
  readonly ledger: StreamWriter;
  readonly content: Pick<RecordedContent, 'put'>;
}

export interface KeptAt {
  readonly asset: KeptAsset;
  readonly at: number;
}

export function assetStreamIn(playbook: ContentOwner, id: string): string {
  return `${streamPrefixOfPlaybook(playbook)}${assetStreamOf(id)}`;
}

export function keptAsset({ ledger, content }: AssetKeeping, asset: AssetToKeep): Effect.Effect<KeptAt, Conflict> {
  return Effect.gen(function* () {
    const { stream, mediaType } = contentOfBytes(asset.bytes, asset.mediaType);
    const held = yield* Effect.orDie(content.put(asset.playbook, { stream, mediaType }));
    const at = yield* Clock.currentTimeMillis;
    const data: AssetKeptData = {
      ...asset.madeBy,
      media_type: held.mediaType,
      bytes: held.bytes,
      sha256: held.sha256,
      expires_at: new Date(at + asset.keptForMs).toISOString(),
    };
    yield* ledger.execute(
      assetStreamIn(asset.playbook, asset.id),
      assetDecider,
      { event: { type: 'asset_kept', data }, context: { ...asset.context, at: new Date(at).toISOString() } },
      asset.lineage,
    );
    return { asset: { id: asset.id, media_type: held.mediaType, bytes: held.bytes, sha256: held.sha256 }, at };
  });
}
