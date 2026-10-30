import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DatabaseSettings } from '@on.auto/workflow-host/testing';
import { onTestFinished } from 'vitest';

export type SettingsOf = () => Promise<DatabaseSettings>;

export const onSQLite: SettingsOf = () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-prediction-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return Promise.resolve({ store: 'sqlite', file: join(directory, 'ledger.db') });
};
