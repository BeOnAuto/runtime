import { fileURLToPath } from 'node:url';

import { sha256Of } from '@on.auto/content';
import { plainPoolsOn, type PostgreSQLPools } from '@on.auto/ledger/postgresql';
import { unreachableDatabase } from '@on.auto/ledger/testing';
import { randomUUIDv7 } from '@on.auto/operations';
import { modulesReachedFrom } from '@on.auto/operations/testing';
import { type Context, Effect, Logger } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { messagesOf } from '../testing/processes/stderr-lines.ts';
import { secretRowsInFile } from '../testing/records/kept-credentials.ts';
import { sqliteLedgerDatabaseOpened } from '../testing/records/opened-ledger-database.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerStoresOpenedBy } from './ledger-stores.ts';
import { postgresqlLedgerDatabase } from './postgresql-ledger-database.ts';

async function aContextLogging(): Promise<{ readonly context: Context.Context<never>; readonly lines: string[] }> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));
  return { context, lines };
}

const sources = fileURLToPath(new URL('..', import.meta.url));

const drivers: ReadonlySet<string> = new Set([
  '@on.auto/ledger/sqlite',
  '@on.auto/ledger/postgresql',
  '@on.auto/node-sqlite',
  'node:sqlite',
  'pg',
]);

function driversReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => drivers.has(name));
}

const [previousKey, currentKey] = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

async function keptUnderThePreviousKey(fileName: string): Promise<void> {
  const rows = await secretRowsInFile(fileName);
  const holding = {
    keptBy: 'ledger',
    held: 'a value',
    wrappedKey: 'no wrapping',
    kid: sha256Of(previousKey).slice(0, 16),
  };
  await Effect.runPromise(rows.keep(randomUUIDv7(), holding));
  await rows.close();
}

describe('the stores of a ledger in PostgreSQL, as the server opens them, without a database', () => {
  it('open the secret store and the webhooks received each on a pool of two connections of its own, which nothing reaches without a previous key, and end them once the work stops', async () => {
    const { url, port } = await unreachableDatabase();
    const { context, lines } = await aContextLogging();
    const bounds: number[] = [];
    const endedYet: (() => boolean)[] = [];
    const stopped: string[] = [];
    const recordedPools: PostgreSQLPools = ({ max }) => {
      const pool = plainPoolsOn(url)({ max });
      bounds.push(max);
      endedYet.push(() => pool.ended);
      return pool;
    };

    const stores = await ledgerStoresOpenedBy(
      context,
      readSettingsOf({ DATABASE_URL: url, SECRETS_KEY: secretsKey }),
      postgresqlLedgerDatabase(recordedPools),
    );
    const served = stores.withSecretsClosed({
      routes: [],
      stopWork: () => {
        stopped.push('the work');
        return Promise.resolve();
      },
    });
    await served.stopWork();

    expect(messagesOf(lines.join('\n'))).toEqual([
      `The ledger is kept in PostgreSQL, in the database playbooks on 127.0.0.1:${port}`,
      "Content is kept in the ledger's database",
      'Payload offloading is on: a payload larger than 16384 bytes is kept as content, and its record names it by its SHA-256 and its size',
      `Secrets are kept in the ledger's database, sealed under the key ${sha256Of(Buffer.from(secretsKey, 'base64')).slice(0, 16)} that SECRETS_KEY holds, and 0 sealed under the previous key were sealed again under it`,
    ]);
    expect({ bounds, ended: endedYet.map((ended) => ended()) }).toEqual({ bounds: [2, 2], ended: [true, true] });
    expect(stopped).toEqual(['the work']);
  });
});

describe('the entries of the ledger the composition imports', () => {
  it('are the one of the store the settings chose, each behind the database of its store, which the composition imports as it starts', () => {
    expect(driversReachedFrom('composition/composition-root.ts')).toEqual([]);
    expect(driversReachedFrom('database/sqlite-ledger-database.ts')).toEqual(['@on.auto/ledger/sqlite']);
    expect(driversReachedFrom('database/postgresql-ledger-database.ts')).toEqual(['@on.auto/ledger/postgresql', 'pg']);
  });
});

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
      await sqliteLedgerDatabaseOpened(fileName),
    );

    await expect(opened).rejects.toThrow(
      `The secrets settings are invalid. SECRETS_KEY_PREVIOUS: The secrets its key sealed could not be sealed again under the current key: The custodian of the key ${sha256Of(previousKey).slice(0, 16)} refused to unwrap a data key: its wrapped key does not open under this key`,
    );
  });
});
