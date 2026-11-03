import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import {
  assetsDue,
  generationsDue,
  makeGenerationFunctionAdapter,
  readGenerationCatalog,
  type AssetsDue,
  type GatewayFetch,
  type GenerationsDue,
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
  readonly dueWork: readonly (AssetsDue | GenerationsDue)[];
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
  const ports = {
    gateways: models.gateways,
    fetch: fetchOutward,
    ledger,
    content: ledger.content,
    addresses: { signedContentAddress, ownOrigin },
    bounds: generation,
  };
  return {
    capability: makeGenerationFunctionAdapter({ ...ports, catalog, ownKey: true }),
    dueWork: [assetsDue({ ledger }), generationsDue(ports)],
  };
}
