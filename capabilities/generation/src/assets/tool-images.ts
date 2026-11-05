import type { ContentOwner } from '@on.auto/content';
import { randomUUIDv7, type Context, type Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import { imageMediaTypeOf } from '../catalog/media-types.ts';
import { roomLeft } from '../run/asset-room.ts';
import type { ToolCallOfAnAsset } from './asset-facts.ts';
import { keptAsset } from './asset-keeping.ts';

export interface ToolImageToKeep {
  readonly playbook: ContentOwner;
  readonly bytes: Readonly<Uint8Array>;
  readonly call: ToolCallOfAnAsset;
  readonly context: Omit<Context, 'at'>;
  readonly lineage: Lineage;
}

export type ToolImagePorts = Pick<GenerationPorts, 'ledger' | 'content' | 'bounds' | 'newAssetId'>;

export type KeepToolImage = (image: ToolImageToKeep) => Effect.Effect<string | undefined>;

export function toolImagesKept(ports: ToolImagePorts): KeepToolImage {
  const bounds = ports.bounds ?? generationBounds;
  const newAssetId = ports.newAssetId ?? randomUUIDv7;
  return (image) => {
    const mediaType = imageMediaTypeOf(image.bytes);
    if (mediaType === undefined || image.bytes.byteLength > bounds.mostBytes.image) {
      return Effect.undefined;
    }
    const kept = () =>
      keptAsset(ports, {
        id: newAssetId(),
        playbook: image.playbook,
        bytes: image.bytes,
        mediaType,
        kind: 'image',
        madeBy: { tool_call: image.call },
        keptForMs: bounds.keptMs,
        context: image.context,
        lineage: image.lineage,
      });
    return roomLeft(ports.ledger, image.playbook, bounds.mostPlaybookBytes).pipe(
      Effect.andThen(kept),
      Effect.map(({ asset }) => asset.id),
      Effect.catchTag('conflict', () => Effect.undefined),
    );
  };
}
