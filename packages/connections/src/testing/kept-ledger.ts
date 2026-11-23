import type { KeptProjection } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';

import { connectionRows } from '../registry/connection-rows.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';

export const connectionsOfAcme = connectionsStreamOfOrg('acme');

export function keptLedger(...projections: readonly KeptProjection[]): MemoryLedger {
  return memoryLedger(undefined, [...projections, connectionRows]);
}
