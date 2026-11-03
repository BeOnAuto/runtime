import type { ContentOwner } from '@on.auto/content';
import { contentAddressLastsSeconds } from '@on.auto/identity';
import type { Schema } from 'effect';

import type { AssetAddresses } from '../capability/generation-ports.ts';

export interface KeptAsset {
  readonly id: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface AssetAddress {
  readonly address: string | null;
  readonly address_until: string | null;
}

export const noAddress: AssetAddress = { address: null, address_until: null };

export function addressOf(
  addresses: AssetAddresses | undefined,
  playbook: ContentOwner,
  sha256: string,
  now: number,
): AssetAddress {
  const until = Math.floor(now / 1000) + contentAddressLastsSeconds;
  const address = addresses?.signedContentAddress(addresses.ownOrigin(), playbook, sha256, until);
  return address === undefined ? noAddress : { address, address_until: new Date(until * 1000).toISOString() };
}

export function assetReferenceOf(asset: KeptAsset, address: AssetAddress): Schema.JsonObject {
  return { ...asset, ...address };
}
