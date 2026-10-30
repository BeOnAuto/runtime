import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryDatabase {
  readonly fileName: string;
  readonly remove: () => void;
}

export function temporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-ledger-'));
  return {
    fileName: join(directory, 'ledger.db'),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
