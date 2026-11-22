import { DatabaseSync } from 'node:sqlite';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { loggedModelAccess } from '../../composition/served-reasoning.ts';
import { startServerInProcess } from '../../lifecycle/lifecycle.ts';
import { inProcessOrigin } from '../servers/in-process-origins.ts';
import { steppedServerClock, testServersStartAt } from '../waiting/stepped-server-clock.ts';
import { temporaryLedger } from './temporary-ledger.ts';

export interface LedgerLayout {
  readonly schema: readonly unknown[];
  readonly rowsIn: Readonly<Record<string, number>>;
}

/** The tables whose rows say how far the ledger is laid out, rather than anything a server recorded in it. */
export const layoutState: ReadonlySet<string> = new Set([
  'auth_layout',
  'dmb_migrations',
  'ledger_layout',
  'projection_checkpoints',
  'sqlite_sequence',
  'sqlite_stat1',
  'workflow_followed_scans',
]);

const tablesQuery = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";

function namesIn(rows: readonly Readonly<Record<string, unknown>>[]): readonly string[] {
  return rows.map((row: Readonly<Record<string, unknown>>) => String(row['name']));
}

function layoutOf(open: () => DatabaseSync): LedgerLayout {
  const database = open();
  try {
    const schema = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
    const rowsIn = Object.fromEntries(
      namesIn(database.prepare(tablesQuery).all()).map((table) => [
        table,
        database.prepare(`SELECT * FROM "${table}"`).all().length,
      ]),
    );
    return { schema, rowsIn };
  } finally {
    database.close();
  }
}

/** The tables, indexes and other objects of a ledger opened from an image, and how many rows each table holds. */
export function layoutOfTheImage(image: Readonly<Uint8Array>): LedgerLayout {
  return layoutOf(() => {
    const database = new DatabaseSync(':memory:');
    database.deserialize(image);
    return database;
  });
}

/** The layout of the ledger file a server leaves, started and stopped on a file of its own by `serve`. */
export async function layoutLeftOnAFileBy(serve: (ledgerFile: string) => Promise<void>): Promise<LedgerLayout> {
  const ledger = temporaryLedger();
  try {
    await serve(ledger.fileName);
    return layoutOf(() => new DatabaseSync(ledger.fileName, { readOnly: true }));
  } finally {
    ledger.remove();
  }
}

const startOfTestServers = new Date(testServersStartAt).toISOString().replace('T', ' ').slice(0, 19);

function emptiedOfWhatTheServerRecorded(fileName: string): Uint8Array {
  const database = new DatabaseSync(fileName);
  try {
    for (const table of namesIn(database.prepare(tablesQuery).all()).filter((name) => !layoutState.has(name))) {
      database.exec(`DELETE FROM "${table}"`);
    }
    database.prepare('UPDATE dmb_migrations SET timestamp = ?').run(startOfTestServers);
    database.exec('PRAGMA journal_mode = DELETE');
    return database.serialize();
  } finally {
    database.close();
  }
}

async function startedAndStoppedOn(ledgerFile: string): Promise<void> {
  const composition = compositionRootWith(loggedModelAccess, {
    goals: true,
    goalsResults: true,
    clock: steppedServerClock(),
  });
  const environment = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledgerFile, AUTO_CLIENTS: 'false' };
  const server = await startServerInProcess(environment, composition, inProcessOrigin());
  await server.stop();
}

/**
 * The image of an empty ledger as a server lays out the ledger it opens: a server started and stopped once on a file
 * of its own, which keeps the rows that say how far the ledger is laid out and none it recorded, its migrations dated
 * at the start of test servers, so the image holds no time of its own. Each call gives a copy, so nothing done with one
 * reaches the next.
 */
export async function migratedLedgerImage(): Promise<() => Readonly<Uint8Array>> {
  const template = temporaryLedger();
  try {
    await startedAndStoppedOn(template.fileName);
    const image = emptiedOfWhatTheServerRecorded(template.fileName);
    return () => image.slice();
  } finally {
    template.remove();
  }
}
