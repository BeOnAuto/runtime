import { contentAddressLastsSeconds } from '@on.auto/identity';
import { defineQuery } from '@on.auto/operations';
import { Schema } from 'effect';

import { dayOf, sizeInWords } from '../assets/asset-words.ts';
import type { GenerationPorts } from '../capability/generation-ports.ts';
import { whatOf } from '../capability/generation-words.ts';
import { AssetIdInputField, assetRead, AssetReadSchema, type AssetRead } from './asset-read.ts';

const minutesAnAddressLasts = contentAddressLastsSeconds / 60;

const description = [
  'Reads one asset of the playbook by its id: its media type, size and SHA-256, the model that made it, when it was kept and when it expires or expired, and whether its content was removed.',
  `It answers an \`address\` its bytes are read at without a key, signed as it is read, until \`address_until\` ${minutesAnAddressLasts} minutes later; both are null once the asset expired or where the runtime signs none.`,
  "Use it to show an asset a generation function made after the address in its run's output expired.",
  "`id` is the asset's id, as that output gives it.",
].join(' ');

const GetAssetInputSchema = Schema.Struct({ id: AssetIdInputField });

function keptInWords(expiresAt: string, address: string | null): string {
  return address === null
    ? `is kept until ${dayOf(expiresAt)}, and no address opens it.`
    : `is kept until ${dayOf(expiresAt)}; its address, in the details below, opens it for ${minutesAnAddressLasts} minutes.`;
}

function outcomeOf(read: AssetRead): string {
  const asset = `The asset, ${whatOf(read.media_type)} of ${sizeInWords(read.bytes)},`;
  if (read.content_removed) {
    return `${asset} has expired, and its content was removed.`;
  }
  if (read.expired || read.expires_at === null) {
    return `${asset} has expired, so no address opens it.`;
  }
  return `${asset} ${keptInWords(read.expires_at, read.address)}`;
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
