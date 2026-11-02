import type { KeyedProjection, ProjectedRow } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { recorded, type RecordedFact } from './recorded-facts.ts';

const finance = { org: 'acme', playbook: 'finance' };

export const financePrefix = 'playbook/acme/finance/';

export interface Projected {
  readonly ledger: MemoryLedger;
  readonly record: (stream: string, ...facts: readonly RecordedFact[]) => Promise<void>;
  readonly rows: () => Promise<Readonly<Record<string, ProjectedRow>>>;
}

export function projected(
  projection: KeyedProjection,
  address: { readonly org: string; readonly playbook?: string } = finance,
): Projected {
  const ledger = memoryLedger(undefined, [projection]);
  return {
    ledger,
    record: (stream, ...facts) => recorded(ledger, stream, facts),
    rows: async () => {
      const kept = await Effect.runPromise(
        ledger.service.readProjectedRows(projection.name, address, {
          where: [],
          orderBy: [],
          order: 'asc',
          limit: 100,
        }),
      );
      return Object.fromEntries(kept.map(({ key, row }) => [key, row]));
    },
  };
}
