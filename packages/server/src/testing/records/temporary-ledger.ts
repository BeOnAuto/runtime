import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TemporaryLedger {
  readonly directory: string;
  readonly fileName: string;
  readonly cacheDirectory: string;
  readonly remove: () => void;
}

export function cacheBeside(ledgerFile: string, name = 'prediction-cache'): string {
  return join(dirname(ledgerFile), name);
}

export function temporaryLedger(): TemporaryLedger {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-server-'));
  return {
    directory,
    fileName: join(directory, 'ledger.db'),
    cacheDirectory: cacheBeside(join(directory, 'ledger.db')),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
