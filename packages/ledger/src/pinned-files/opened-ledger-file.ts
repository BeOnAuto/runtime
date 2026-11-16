import { Ledger } from '@on.auto/operations';
import type { SecretRows } from '@on.auto/secrets';
import { Effect, ManagedRuntime } from 'effect';

import { LedgerConnection, type ConnectionPorts } from '../connection/ledger-connection.ts';
import { LedgerChores, type ChorePorts } from '../content/content-sweep.ts';
import type { StoreLayerOptions } from '../ledger-layer.ts';
import { sqliteLedgerFile } from '../sqlite3.ts';
import type { ReceivedWebhooks } from '../webhooks/received-webhooks.ts';
import { pinnedTables } from './pinned-tables.ts';

export interface OpenedLedgerFile {
  readonly ledger: Ledger['Service'];
  readonly connection: ConnectionPorts;
  readonly chores: ChorePorts;
  readonly secretRows: SecretRows;
  readonly receivedWebhooks: ReceivedWebhooks;
  readonly close: () => Promise<void>;
}

async function openedLedgerFile(fileName: string, tables: StoreLayerOptions): Promise<OpenedLedgerFile> {
  const file = sqliteLedgerFile(fileName);
  const runtime = ManagedRuntime.make(file.ledgerLayer(tables));
  const [ledger, connection, chores, secretRows, receivedWebhooks] = await runtime.runPromise(
    Effect.all([
      Effect.service(Ledger),
      Effect.service(LedgerConnection),
      Effect.service(LedgerChores),
      file.secretRows,
      file.receivedWebhooks,
    ]),
  );
  return { ledger, connection, chores, secretRows, receivedWebhooks, close: () => runtime.dispose() };
}

export async function onTheLedgerOf<A>(
  fileName: string,
  use: (open: OpenedLedgerFile) => Promise<A>,
  tables: StoreLayerOptions = pinnedTables,
): Promise<A> {
  const open = await openedLedgerFile(fileName, tables);
  try {
    return await use(open);
  } finally {
    await open.close();
  }
}
