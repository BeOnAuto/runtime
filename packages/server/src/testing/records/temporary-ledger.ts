import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryLedger {
  readonly directory: string;
  readonly fileName: string;
  readonly remove: () => void;
}

export function temporaryLedger(): TemporaryLedger {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-server-'));
  return {
    directory,
    fileName: join(directory, 'ledger.db'),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
