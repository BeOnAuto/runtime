import { contentOfBytes, type RecordedContent } from '@on.auto/content';
import {
  runStreamNameOf,
  streamPrefixOfPlaybook,
  type Conflict,
  type Context,
  type LedgerPorts,
  type Lineage,
  type StreamWriter,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { assetDecider } from './asset-decider.ts';
import {
  assetStreamOf,
  type AssetKeptDataWritten,
  type AssetMadeBy,
  type GenerationKindWritten,
  type KindWritten,
  type MadeByWritten,
} from './asset-facts.ts';
import type { KeptAsset } from './asset-reference.ts';

type Generation = Extract<AssetMadeBy, { readonly generation: unknown }>['generation'];

export type MadeByAGeneration = Generation & { readonly kind: GenerationKindWritten };

export interface AssetToKeep {
  readonly id: string;
  readonly playbook: PlaybookAddress;
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
  readonly kind: KindWritten;
  readonly madeBy: MadeByWritten;
  readonly keptForMs: number;
  readonly context: KeptByARun;
  readonly lineage: Lineage;
}

export type KeptByARun = Omit<Context, 'at'> & { readonly runId: string };

export interface AssetKeeping {
  readonly ledger: StreamWriter & Pick<LedgerPorts, 'holderOfStream'>;
  readonly content: Pick<RecordedContent, 'put'>;
}

export interface KeptAt {
  readonly asset: KeptAsset;
  readonly at: number;
}

export function assetStreamIn(definitionKey: string, id: string): string {
  return `${definitionKey}${assetStreamOf(id)}`;
}

function definitionOfTheRun({ ledger }: AssetKeeping, { playbook, context }: AssetToKeep): Effect.Effect<string> {
  const { runId } = context;
  return Effect.flatMap(
    ledger.holderOfStream({ playbookKey: streamPrefixOfPlaybook(playbook), stream: runStreamNameOf(runId) }),
    (key) =>
      key === undefined
        ? Effect.die(
            new Error(`The run ${runId} that keeps an asset is not a run of the playbook ${playbook.playbook}`),
          )
        : Effect.succeed(key),
  );
}

export function madeByThe({ kind, ...generation }: MadeByAGeneration): Pick<AssetToKeep, 'kind' | 'madeBy'> {
  return { kind, madeBy: { generation } };
}

export function keptAsset(keeping: AssetKeeping, asset: AssetToKeep): Effect.Effect<KeptAt, Conflict> {
  const { ledger, content } = keeping;
  return Effect.gen(function* () {
    const definitionKey = yield* definitionOfTheRun(keeping, asset);
    const { stream, mediaType } = contentOfBytes(asset.bytes, asset.mediaType);
    const held = yield* Effect.orDie(content.put(asset.playbook, { stream, mediaType }));
    const at = yield* Clock.currentTimeMillis;
    const data: AssetKeptDataWritten = {
      media_type: held.mediaType,
      bytes: held.bytes,
      sha256: held.sha256,
      kind: asset.kind,
      made_by: asset.madeBy,
      expires_at: new Date(at + asset.keptForMs).toISOString(),
    };
    yield* ledger.execute(
      assetStreamIn(definitionKey, asset.id),
      assetDecider,
      { event: { type: 'asset_kept', data }, context: { ...asset.context, at: new Date(at).toISOString() } },
      asset.lineage,
    );
    return { asset: { id: asset.id, media_type: held.mediaType, bytes: held.bytes, sha256: held.sha256 }, at };
  });
}
