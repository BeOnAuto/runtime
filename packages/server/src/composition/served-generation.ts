import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import {
  assetsDue,
  makeGenerationFunctionAdapter,
  readGenerationCatalog,
  type AssetsDue,
  type GatewayFetch,
} from '@on.auto/generation';
import { contentAddressesUnder, type ContentAddressKey } from '@on.auto/identity';
import type { DispatcherServices } from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Result } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface GenerationWiring {
  readonly shippedFiles: ShippedFiles;
  readonly contentAddressKey: ContentAddressKey;
  readonly ownOrigin: () => string;
}

export interface ServedGeneration {
  readonly capability: Capability;
  readonly dueWork: AssetsDue;
}

const fetchOutward: GatewayFetch = (request) => fetch(request);

export async function generationServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { models, generation }: Pick<Settings, 'models' | 'generation'>,
  { shippedFiles, contentAddressKey, ownOrigin }: GenerationWiring,
): Promise<ServedGeneration> {
  const catalog = Result.getOrThrow(await readGenerationCatalog(shippedFiles));
  const ledger = runtimeLedger(runtime);
  const { signedContentAddress } = contentAddressesUnder(contentAddressKey);
  return {
    capability: makeGenerationFunctionAdapter({
      catalog,
      gateways: models.gateways,
      fetch: fetchOutward,
      ownKey: true,
      ledger,
      content: ledger.content,
      addresses: { signedContentAddress, ownOrigin },
      bounds: generation,
    }),
    dueWork: assetsDue({ ledger }),
  };
}
