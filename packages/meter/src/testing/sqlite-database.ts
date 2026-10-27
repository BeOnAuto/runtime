import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer, sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { onTestFinished } from 'vitest';

import { openedDatabase, wrappingKey, type MeterDatabase } from './database.ts';

export async function sqliteDatabase(): Promise<MeterDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'auto-meter-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const fileName = join(directory, 'ledger.db');
  return openedDatabase({
    layer: ledgerLayer({ fileName }),
    secretRows: sqliteSecretRows({ fileName }),
    key: wrappingKey(),
  });
}
