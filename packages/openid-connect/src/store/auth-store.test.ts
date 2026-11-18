import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { onTestFinished } from 'vitest';

import { authStoreBehaviour, sessionsEndedBehaviour } from './auth-store-behaviour.ts';

function aLedgerFile(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auth-store-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return join(folder, 'ledger.db');
}

authStoreBehaviour({
  name: 'on a SQLite file',
  aDatabase: () => {
    const fileName = aLedgerFile();
    return Promise.resolve(() => ledgerLayer({ fileName }));
  },
});

sessionsEndedBehaviour({
  name: "in SQLite's private memory",
  aDatabase: () => Promise.resolve(() => ledgerLayer({ fileName: ':memory:' })),
});
