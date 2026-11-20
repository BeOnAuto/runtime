import { defineQuery } from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { dayOf } from '../assets/asset-words.ts';
import type { GenerationPorts } from '../capability/generation-ports.ts';
import { whatOf } from '../capability/generation-words.ts';
import { AssetIdInputField, assetRead, AssetReadSchema, type AssetRead } from './asset-read.ts';

const description = [
  "Reads one asset of the playbook by its id, as a run's output or a tool's image gives it: its media type, size and SHA-256, the model that made it, if any, when it was kept, when it expires or expired, if it has an expiry, and whether its content was removed.",
  'It answers an `address` its bytes are read at without a key while the asset is kept, and `address_until`, when the asset expires, or null if it has no expiry; both are null once it expired or where the runtime signs none.',
  'Use it to show an asset, or to check that it is still kept.',
].join(' ');

const GetAssetInputSchema = Schema.Struct({ id: AssetIdInputField });

function keptInWords(expiresAt: string | null): string {
  return expiresAt === null ? 'is kept with no expiry' : `is kept until ${dayOf(expiresAt)}`;
}

function openedInWords(expiresAt: string | null, address: string | null): string {
  if (address === null) {
    return 'and no address opens it.';
  }
  return expiresAt === null
    ? 'and its address, in the details below, opens it.'
    : 'and its address, in the details below, opens it until then.';
}

function outcomeOf(read: AssetRead): string {
  const asset = `The asset, ${whatOf(read.media_type)} of ${sizeInWords(read.bytes)},`;
  if (read.content_removed) {
    return `${asset} has expired, and its content was removed.`;
  }
  if (read.expired) {
    return `${asset} has expired, so no address opens it.`;
  }
  return `${asset} ${keptInWords(read.expires_at)}, ${openedInWords(read.expires_at, read.address)}`;
}

export function defineGetAsset({ addresses }: Pick<GenerationPorts, 'addresses'>) {
  return defineQuery('playbook', {
    name: 'get_asset',
    title: 'Get asset',
    description,
    route: { method: 'GET', path: '/assets/{id}' },
    inputSchema: GetAssetInputSchema,
    outputSchema: AssetReadSchema,
    reasons: ['not_found'],
    handle: ({ id }) => assetRead(addresses, id),
    plainLanguage: {
      task: 'look up an asset',
      attempt: () => 'look up the asset',
      outcome: outcomeOf,
    },
  });
}
