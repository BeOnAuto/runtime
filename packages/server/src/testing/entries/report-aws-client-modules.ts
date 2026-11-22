import { createRequire } from 'node:module';

import { Effect, Logger, ManagedRuntime, Schema } from 'effect';

import { ledgerStoresOpenedBy } from '../../database/ledger-stores.ts';
import { sqliteLedgerDatabase } from '../../database/sqlite-ledger-database.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { readSettingsOf } from '../settings/shipped-settings.ts';

type Environment = Readonly<Record<string, string>>;

const environments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.String))),
)(process.argv[2]);

const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([]))));

async function openedAndClosed(environment: Environment): Promise<void> {
  const { fileName, remove } = temporaryLedger();
  const database = sqliteLedgerDatabase(fileName);
  const runtime = ManagedRuntime.make(database.ledgerLayer({}));
  await runtime.runPromise(Effect.void);
  const stores = await ledgerStoresOpenedBy(
    context,
    readSettingsOf({ LEDGER_FILE: fileName, ...environment }),
    database,
  );
  await stores.secrets.close();
  await runtime.dispose();
  remove();
}

await environments.reduce<Promise<void>>(
  (before, environment) => before.then(() => openedAndClosed(environment)),
  Promise.resolve(),
);

const modulesOfTheClients = Object.keys(createRequire(import.meta.url).cache).filter(
  (path) => path.includes('/@aws-sdk/client-kms/') || path.includes('/@aws-sdk/client-ssm/'),
);
process.stdout.write(JSON.stringify(modulesOfTheClients));
