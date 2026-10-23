import type { Layer } from 'effect';

import { ledgerLayerOver, type LedgerServices, type OpenedLedger } from '../ledger-layer.ts';

export interface WatchedSweeps {
  readonly layer: Layer.Layer<LedgerServices>;
  readonly started: Promise<void>;
  readonly finished: Promise<string>;
}

export function sweepsWatched(openedOf: () => OpenedLedger, held: Promise<void> = Promise.resolve()): WatchedSweeps {
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<string>();
  const open = (): OpenedLedger => {
    const { store, connection } = openedOf();
    return {
      store: {
        ...store,
        sweepContent: async (before) => {
          started.resolve();
          await held;
          finished.resolve(await store.sweepContent(before).then(() => 'swept', String));
        },
      },
      connection,
    };
  };
  return { layer: ledgerLayerOver(open), started: started.promise, finished: finished.promise };
}

function ended(): 'ended' {
  return 'ended';
}

export function endingOf(chore: Promise<unknown>): Promise<'ended'> {
  return chore.then(ended, ended);
}
