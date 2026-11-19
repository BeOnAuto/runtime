import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LedgerConnection, type ConnectionPorts } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Effect, ManagedRuntime } from 'effect';

import { authStoreOpened, type AuthStore } from '../store/auth-store.ts';

export interface StoreOnAFile {
  readonly store: AuthStore;
  readonly connection: ConnectionPorts;
  readonly close: () => Promise<void>;
}

export async function authStoreOnAFile(): Promise<StoreOnAFile> {
  const folder = mkdtempSync(join(tmpdir(), 'auth-store-'));
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName: join(folder, 'ledger.db') }));
  const connection = await runtime.runPromise(Effect.service(LedgerConnection));
  return {
    store: await authStoreOpened(connection),
    connection,
    close: async () => {
      await runtime.dispose();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
