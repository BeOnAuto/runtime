import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { AssetContent, AssetReference } from './asset-references.ts';

export interface AssetUnusable {
  readonly id: string;
  readonly detail: string;
}

export interface HeldAsset {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content: AssetContent;
  readonly opened: () => Effect.Effect<ReadableStream<Uint8Array>, AssetUnusable>;
}

export interface AssetHolding {
  readonly held: (playbook: PlaybookAddress, reference: AssetReference) => Effect.Effect<HeldAsset, AssetUnusable>;
}

type UnusableBecause = 'not_kept' | 'other_bytes' | 'expired' | 'content_gone';

type Named = Pick<AssetReference, 'id' | 'sha256'>;

const keptByThePlaybook = 'give an asset this playbook keeps, as the run that made it answered it';

const madeAgain = 'run again what made it, for a fresh copy';

const unusableWords: Readonly<Record<UnusableBecause, (named: Named) => string>> = {
  not_kept: ({ id }) => `No asset of this playbook has the id ${id}; ${keptByThePlaybook}`,
  other_bytes: ({ id, sha256 }) =>
    `No asset of this playbook has the id ${id} with the SHA-256 ${sha256}; ${keptByThePlaybook}`,
  expired: ({ id }) => `The asset ${id} has expired; ${madeAgain}`,
  content_gone: ({ id }) => `The content of the asset ${id} is no longer kept; ${madeAgain}`,
};

export function assetUnusable(because: UnusableBecause, named: Named): AssetUnusable {
  return { id: named.id, detail: unusableWords[because](named) };
}

export const noAssetsHeld: AssetHolding = {
  held: (_playbook, reference) => Effect.fail(assetUnusable('not_kept', reference)),
};
