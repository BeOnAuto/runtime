import type { Ledger } from '@on.auto/operations';

import { memoryKeeperOn } from '../keeper/kept-in-a-ledger.ts';
import type { MemoryKeeper, MemoryLedger } from '../keeper/memory-keeper.ts';

export type LedgerOver = (ledger: Ledger['Service']) => MemoryLedger;

export type OrganizationKeeping = ((ledger: MemoryLedger) => MemoryKeeper) | 'none';

export interface KeepingAsked {
  readonly organization?: OrganizationKeeping;
  readonly mostKept?: number;
}

export function organizationKeeperIn(
  adapted: MemoryLedger,
  { organization, mostKept }: KeepingAsked,
): MemoryKeeper | undefined {
  if (organization === 'none') {
    return undefined;
  }
  return organization === undefined
    ? memoryKeeperOn({ ledger: adapted, ...(mostKept === undefined ? {} : { mostKept }) })
    : organization(adapted);
}
