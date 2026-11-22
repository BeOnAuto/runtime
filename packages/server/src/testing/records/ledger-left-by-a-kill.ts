import { cpSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { onTestFinished } from 'vitest';

import { temporaryLedger, type TemporaryLedger } from './temporary-ledger.ts';

/**
 * What a server killed at this moment leaves of the ledger file it runs on: every transaction it committed and
 * nothing it had not, beside the other files of its directory, in a ledger of the test's own. A second server composed
 * over it stands where a server started after a kill stands: the first, still running in the process, is then stopped
 * on its own file, so nothing its shutdown does reaches the ledger the second reads.
 */
export function ledgerLeftByAKill(running: TemporaryLedger): TemporaryLedger {
  const left = temporaryLedger();
  onTestFinished(left.remove);
  const own = new Set(['', '-wal', '-shm', '-journal'].map((suffix) => `${basename(running.fileName)}${suffix}`));
  for (const name of readdirSync(running.directory).filter((each) => !own.has(each))) {
    cpSync(join(running.directory, name), join(left.directory, name), { recursive: true });
  }
  const database = new DatabaseSync(running.fileName, { readOnly: true });
  try {
    database.prepare('VACUUM INTO ?').run(left.fileName);
  } finally {
    database.close();
  }
  return left;
}
