import type { RecordedContent } from '@on.auto/content';
import type { SignedContentAddress } from '@on.auto/identity';
import type { ProjectionReader, StreamWriter } from '@on.auto/operations';

import type { GenerationKind } from '../catalog/catalog-entry.ts';
import type { GenerationCatalog } from '../catalog/generation-catalog.ts';
import type { GatewayFetch, GenerationGateway } from '../gateway/generation-gateway.ts';

const mebibyte = 1_048_576;

const day = 86_400_000;

export interface GenerationBounds {
  readonly mostBytes: Readonly<Record<GenerationKind, number>>;
  readonly mostPlaybookBytes: number;
  readonly keptMs: number;
}

export const generationBounds: GenerationBounds = {
  mostBytes: { image: 20 * mebibyte, audio: 50 * mebibyte, video: 200 * mebibyte },
  mostPlaybookBytes: 2048 * mebibyte,
  keptMs: 90 * day,
};

interface AssetLedger extends StreamWriter, Pick<ProjectionReader, 'readProjectedRows'> {}

export interface AssetAddresses {
  readonly signedContentAddress: SignedContentAddress;
  readonly ownOrigin: () => string;
}

export interface GenerationPorts {
  readonly catalog: GenerationCatalog;
  readonly gateways: readonly GenerationGateway[];
  readonly fetch: GatewayFetch;
  readonly ownKey: boolean;
  readonly ledger: AssetLedger;
  readonly content: Pick<RecordedContent, 'put' | 'get'>;
  readonly addresses?: AssetAddresses;
  readonly bounds?: GenerationBounds;
  readonly newAssetId?: () => string;
  readonly answerMs?: number;
}
