import type { Pragma, Pragmas } from './pragmas.ts';
import { isAtLeast, sqliteVersionRefusal } from './sqlite-version.ts';
import { inTurn, valuesOf, type Answering, type OpenDatabase } from './statements.ts';

export interface Connecting {
  readonly database: OpenDatabase;
  readonly answered: Answering;
  readonly pragmas: Pragmas;
  readonly minimumSQLiteVersion?: string | undefined;
  readonly skipDatabasePragmas?: boolean | undefined;
}

function pragmaSet({ database, answered }: Connecting, { pragma, value }: Pragma): Promise<void> {
  return answered(() => {
    database.prepare(`PRAGMA ${pragma} = ${String(value)}`).run();
  });
}

async function sqliteVersionKept({ database, answered }: Connecting, minimum: string): Promise<void> {
  for (const found of await answered(() => valuesOf(database, 'SELECT sqlite_version()').map(String))) {
    if (!isAtLeast(found, minimum)) {
      database.close();
      throw sqliteVersionRefusal(found, minimum);
    }
  }
}

async function journalModeKept(connecting: Connecting): Promise<void> {
  const { database, answered, pragmas } = connecting;
  const wanted = String(pragmas.journalMode);
  const found = await answered(() =>
    valuesOf(database, 'PRAGMA journal_mode')
      .map(String)
      .map((mode) => mode.toUpperCase()),
  );
  if (!found.includes(wanted.toUpperCase())) {
    await pragmaSet(connecting, { pragma: 'journal_mode', value: wanted });
  }
}

export async function connectedWith(connecting: Connecting): Promise<void> {
  if (connecting.minimumSQLiteVersion !== undefined) {
    await sqliteVersionKept(connecting, connecting.minimumSQLiteVersion);
  }
  await inTurn(connecting.pragmas.ofTheConnection, (pragma) => pragmaSet(connecting, pragma));
  if (connecting.skipDatabasePragmas !== true) {
    await journalModeKept(connecting);
  }
}
