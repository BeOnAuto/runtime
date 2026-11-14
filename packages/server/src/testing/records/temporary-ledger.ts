import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** A ledger file's path under a plain file in the ledger's directory, which no server can open. */
export function aPathUnderAFile({ directory }: Pick<TemporaryLedger, 'directory'>): string {
  const aFile = join(directory, 'a-file');
  writeFileSync(aFile, '');
  return join(aFile, 'ledger.db');
}
