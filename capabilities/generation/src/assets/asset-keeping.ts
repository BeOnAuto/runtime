import { contentOfBytes, type ContentOwner, type RecordedContent } from '@on.auto/content';
import { streamPrefixOfPlaybook, type Context, type Lineage, type StreamWriter } from '@on.auto/operations';
import { Effect } from 'effect';

import { assetDecider } from './asset-decider.ts';
import { assetStreamOf, type AssetKeptData } from './asset-facts.ts';
import type { KeptAsset } from './asset-reference.ts';

export interface AssetToKeep {
  readonly id: string;
  readonly playbook: ContentOwner;
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
  readonly kept: Omit<AssetKeptData, 'media_type' | 'bytes' | 'sha256'>;
  readonly context: Context;
  readonly lineage: Lineage;
}

export interface AssetKeeping {
  readonly ledger: StreamWriter;
  readonly content: Pick<RecordedContent, 'put'>;
}

export function assetStreamIn(playbook: ContentOwner, id: string): string {
  return `${streamPrefixOfPlaybook(playbook)}${assetStreamOf(id)}`;
}

export function keptAsset({ ledger, content }: AssetKeeping, asset: AssetToKeep): Effect.Effect<KeptAsset> {
  return Effect.gen(function* () {
    const { stream, mediaType } = contentOfBytes(asset.bytes, asset.mediaType);
    const held = yield* Effect.orDie(content.put(asset.playbook, { stream, mediaType }));
    const data: AssetKeptData = { ...asset.kept, media_type: held.mediaType, bytes: held.bytes, sha256: held.sha256 };
    yield* Effect.orDie(
      ledger.execute(
        assetStreamIn(asset.playbook, asset.id),
        assetDecider,
        { event: { type: 'asset_kept', data }, context: asset.context },
        asset.lineage,
      ),
    );
    return { id: asset.id, media_type: held.mediaType, bytes: held.bytes, sha256: held.sha256 };
  });
}
