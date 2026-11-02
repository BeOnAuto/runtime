import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { describe, onTestFinished } from 'vitest';

import { assetsOnStoresSuite } from '../store-testing/assets-on-stores.ts';

describe('the assets of playbooks on SQLite', () => {
  assetsOnStoresSuite((projections) => {
    const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-generation-'));
    onTestFinished(() => {
      rmSync(directory, { recursive: true, force: true });
    });
    return Promise.resolve(ledgerLayer({ fileName: join(directory, 'ledger.db'), projections }));
  });
});
