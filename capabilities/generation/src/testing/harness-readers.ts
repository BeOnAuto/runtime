import { streamPrefixOfPlaybook, type Fold, type PlaybookAddress } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { AssetEventSchema, assetStreamOf, type AssetEvent } from '../assets/asset-facts.ts';
import { assetStreamIn } from '../assets/asset-keeping.ts';
import {
  assetRowOf,
  assetsName,
  assetTotalsName,
  rowKeyed,
  totalsRowOf,
  type AssetRow,
  type TotalsRow,
} from '../assets/asset-projections.ts';
import { alpha } from './harness-calls.ts';

export interface HarnessReaders {
  readonly factsOf: (id: string) => Promise<readonly AssetEvent[]>;
  readonly rowOf: (id: string) => Promise<AssetRow | undefined>;
  readonly totals: () => Promise<TotalsRow>;
  readonly definitionKeyOf: (name: string, playbook?: PlaybookAddress) => Promise<string>;
}

const noFacts: readonly AssetEvent[] = [];

const collected: Fold<readonly AssetEvent[], AssetEvent> = {
  initialState: noFacts,
  evolve: (facts, fact) => [...facts, fact],
  eventSchema: AssetEventSchema,
};

const everyTotal = { where: [], orderBy: [], order: 'asc', limit: 1000 } as const;

function summed(rows: readonly TotalsRow[]): TotalsRow {
  return rows.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, assets: sum.assets + row.assets }), {
    bytes: 0,
    assets: 0,
  });
}

export function readersOn({ service }: MemoryLedger): HarnessReaders {
  const factsOf = (id: string) =>
    Effect.flatMap(
      service.holderOfStream({ playbookKey: streamPrefixOfPlaybook(alpha), stream: assetStreamOf(id) }),
      (key) =>
        key === undefined
          ? Effect.succeed(noFacts)
          : Effect.map(service.load(assetStreamIn(key, id), collected), ({ state }) => state),
    );
  return {
    factsOf: (id) => Effect.runPromise(factsOf(id)),
    rowOf: async (id) => {
      const [kept] = await Effect.runPromise(service.readProjectedRows(assetsName, alpha, rowKeyed(id)));
      return assetRowOf(kept?.row);
    },
    totals: async () => {
      const rows = await Effect.runPromise(service.readProjectedRows(assetTotalsName, alpha, everyTotal));
      return summed(rows.map(({ row }) => totalsRowOf(row)));
    },
    definitionKeyOf: async (name, playbook = alpha) => {
      const held = await Effect.runPromise(
        service.holderOfName({ playbookKey: streamPrefixOfPlaybook(playbook), definitionType: 'generation', name }),
      );
      if (held === undefined) {
        throw new Error(`No generation function holds the name ${name} in the playbook ${playbook.playbook}`);
      }
      return held.definitionKey;
    },
  };
}
