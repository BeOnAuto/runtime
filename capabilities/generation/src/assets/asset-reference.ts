import type { PlaybookAddress } from '@on.auto/operations';
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
  playbook: PlaybookAddress,
  sha256: string,
  expiresAt: number | null,
): AssetAddress {
  const until = expiresAt === null ? undefined : Math.floor(expiresAt / 1000);
  const address = addresses?.signedContentAddress(addresses.ownOrigin(), playbook, sha256, until);
  if (address === undefined) {
    return noAddress;
  }
  return { address, address_until: until === undefined ? null : new Date(until * 1000).toISOString() };
}

export function assetReferenceOf(asset: KeptAsset, address: AssetAddress): Schema.JsonObject {
  return { ...asset, ...address };
}
