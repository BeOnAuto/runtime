import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

export function aTemporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'node-sqlite-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

export function aDatabaseFile(): string {
  return join(aTemporaryFolder(), 'database.db');
}
