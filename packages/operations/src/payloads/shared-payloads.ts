import { Context } from 'effect';

import { noPayloadCache, payloadCacheWithin, type PayloadCache } from './payload-cache.ts';
import { noPayloadGate, payloadGateOf, type PayloadGate } from './payload-gate.ts';

export interface SharedPayloads {
  readonly cache: PayloadCache;
  readonly gate: PayloadGate;
}

export const noSharedPayloads: SharedPayloads = { cache: noPayloadCache, gate: noPayloadGate };

export function sharedPayloadsWithin(cacheBytes: number): SharedPayloads {
  return { cache: payloadCacheWithin(cacheBytes), gate: payloadGateOf() };
}

export const PayloadsShared = Context.Reference<SharedPayloads>('@on.auto/operations/PayloadsShared', {
  defaultValue: () => noSharedPayloads,
});
