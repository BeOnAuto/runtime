import type { Fold, ProjectedRowsQuery } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { AssetEventSchema, type AssetEvent } from '../assets/asset-facts.ts';
import { assetStreamIn } from '../assets/asset-keeping.ts';
import {
  assetRowOf,
  assetsName,
  assetTotalsName,
  totalsKey,
  totalsRowOf,
  type AssetRow,
  type TotalsRow,
} from '../assets/asset-projections.ts';
import { alpha } from './harness-calls.ts';

export interface HarnessReaders {
  readonly factsOf: (id: string) => Promise<readonly AssetEvent[]>;
  readonly rowOf: (id: string) => Promise<AssetRow | undefined>;
  readonly totals: () => Promise<TotalsRow>;
}

const noFacts: readonly AssetEvent[] = [];

const collected: Fold<readonly AssetEvent[], AssetEvent> = {
  initialState: noFacts,
  evolve: (facts, fact) => [...facts, fact],
  eventSchema: AssetEventSchema,
};

function keyedRow(key: string): ProjectedRowsQuery {
  return { where: [{ column: 'row_key', equals: key }], orderBy: [], order: 'asc', limit: 1 };
}

export function readersOn({ service }: MemoryLedger): HarnessReaders {
  return {
    factsOf: async (id) => (await Effect.runPromise(service.load(assetStreamIn(alpha, id), collected))).state,
    rowOf: async (id) => {
      const [kept] = await Effect.runPromise(service.readProjectedRows(assetsName, alpha, keyedRow(id)));
      return assetRowOf(kept?.row);
    },
    totals: async () => {
      const [kept] = await Effect.runPromise(service.readProjectedRows(assetTotalsName, alpha, keyedRow(totalsKey)));
      return totalsRowOf(kept?.row);
    },
  };
}
