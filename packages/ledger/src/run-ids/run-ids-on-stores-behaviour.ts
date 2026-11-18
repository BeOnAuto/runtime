import type { RunIds } from '@on.auto/operations';
import { runIdsBehaviour } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import type { LedgerStore } from '../event-store.ts';
import { makeLedger } from '../ledger-service.ts';

export interface RunIdsStores {
  readonly aDatabase: () => Promise<string>;
  readonly storeOn: (database: string, runIds: RunIds) => LedgerStore;
}

export function runIdsOnStoresBehaviour({ aDatabase, storeOn }: RunIdsStores): void {
  runIdsBehaviour(async (runIds) => {
    const store = storeOn(await aDatabase(), runIds);
    onTestFinished(() => store.close());
    await store.migrate();
    return makeLedger(store);
  });
}
