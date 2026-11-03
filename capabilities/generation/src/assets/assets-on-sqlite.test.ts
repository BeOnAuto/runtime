import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import type { KeyedProjection } from '@on.auto/operations';
import { describe, onTestFinished } from 'vitest';

import { assetsOnStoresSuite } from '../store-testing/assets-on-stores.ts';
import { waitingOnStoresSuite } from '../store-testing/waiting-on-stores.ts';

function onSQLite(projections: readonly KeyedProjection[]) {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-generation-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return Promise.resolve(ledgerLayer({ fileName: join(directory, 'ledger.db'), projections }));
}

describe('the assets of playbooks on SQLite', () => {
  assetsOnStoresSuite(onSQLite);
});

describe('the generations playbooks wait for on SQLite', () => {
  waitingOnStoresSuite(onSQLite);
});
