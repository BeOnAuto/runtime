import { sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { randomUUIDv7, sha256Of } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';
import { sqliteLedgerDatabase } from './sqlite-ledger-database.ts';

const [previousKey, currentKey] = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

async function keptUnderThePreviousKey(fileName: string): Promise<void> {
  const rows = await Effect.runPromise(sqliteSecretRows({ fileName }));
  const holding = {
    keptBy: 'ledger',
    held: 'a value',
    wrappedKey: 'no wrapping',
    kid: sha256Of(previousKey).slice(0, 16),
  };
  await Effect.runPromise(rows.keep(randomUUIDv7(), holding));
  await rows.close();
}

describe('the stores of a ledger whose secrets the previous key cannot unwrap', () => {
  it('stop the start, naming the setting of the previous key before the words of its custodian', async () => {
    const fileName = aLedgerFile();
    await keptUnderThePreviousKey(fileName);
    const settings = readSettingsOf({
      LEDGER_FILE: fileName,
      SECRETS_KEY: currentKey.toString('base64'),
      SECRETS_KEY_PREVIOUS: previousKey.toString('base64'),
    });

    const opened = ledgerStoresOpenedBy(
      await Effect.runPromise(Effect.context()),
      settings,
      sqliteLedgerDatabase(fileName),
    );

    await expect(opened).rejects.toThrow(
      `The secrets settings are invalid. SECRETS_KEY_PREVIOUS: The secrets its key sealed could not be sealed again under the current key: The custodian of the key ${sha256Of(previousKey).slice(0, 16)} refused to unwrap a data key: its wrapped key does not open under this key`,
    );
  });
});
