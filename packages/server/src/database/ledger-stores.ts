import type { SecretStore } from '@on.auto/secrets';
import { Effect, type Context } from 'effect';

import { logContentStore, logLedger } from '../logging/logging.ts';
import { loadAwsAdapters, type AwsAdaptersLoader } from '../secrets/aws-adapters.ts';
import { keepersOf } from '../secrets/secret-keepers.ts';
import { secretStoreStarted } from '../secrets/secret-store-start.ts';
import { custodiansOf } from '../secrets/secret-store.ts';
import type { Served } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import type { LedgerDatabase } from './ledger-database.ts';

export interface LedgerStores {
  readonly secrets: SecretStore;
  readonly withSecretsClosed: (served: Served) => Served;
}

type StoresSettings = Pick<Settings, 'ledger' | 'content' | 'secrets' | 'keepers' | 'proxy'>;

export async function ledgerStoresOpenedBy(
  context: Context.Context<never>,
  { ledger, content, secrets, keepers, proxy }: StoresSettings,
  database: LedgerDatabase,
  loadAws: AwsAdaptersLoader = loadAwsAdapters,
): Promise<LedgerStores> {
  const run = Effect.runPromiseWith(context);
  await run(Effect.andThen(logLedger(ledger), logContentStore(content)));
  const making = { proxy, loadAws };
  const custodians = secrets === undefined ? undefined : await custodiansOf(secrets, making);
  const kept = await keepersOf(keepers, custodians, making);
  const store = await run(secretStoreStarted(database, { custodians, keepers: kept }, { secrets, keepers }));
  return {
    secrets: store,
    withSecretsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await store.close();
      },
    }),
  };
}
