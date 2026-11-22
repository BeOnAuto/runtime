import { existsSync, fstatSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Ledger } from '@on.auto/operations';
import { Cause, Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { ledgerLayoutFloor } from './layout/ledger-layout.ts';
import { aSQLiteFileInLayout, ledgerLayer, sqliteLedgerFile } from './sqlite.ts';
import { openLedgerWith } from './testing/open-ledger.ts';
import { tally, tallyInterruptedBy } from './testing/tally.ts';
import { imageOfTheDatabaseIn, temporaryDatabase, type TemporaryDatabase } from './testing/temporary-database.ts';

const databases: TemporaryDatabase[] = [];

function aDatabaseFile(): string {
  const database = temporaryDatabase();
  databases.push(database);
  return database.fileName;
}

afterEach(() => {
  for (const { remove } of databases.splice(0)) {
    remove();
  }
});

const tallies = 'org/acme/tallies';

function opensTheFile(descriptor: number, device: number, inode: number): boolean {
  try {
    const opened = fstatSync(descriptor);
    return opened.dev === device && opened.ino === inode;
  } catch {
    return false;
  }
}

async function imageOfALedgerHolding(amounts: readonly number[]): Promise<Uint8Array> {
  const fileName = aDatabaseFile();
  const template = await openLedgerWith(ledgerLayer({ fileName }));
  await Effect.runPromise(template.ledger.execute(tallies, tally, amounts));
  await template.dispose();
  return imageOfTheDatabaseIn(fileName);
}

function failureToBuild(fileName: string): Promise<Cause.Cause<never>> {
  return Effect.runPromise(Effect.provide(Ledger, ledgerLayer({ fileName })).pipe(Effect.sandbox, Effect.flip));
}

function descriptorsOpenOn(fileName: string): number {
  const { dev, ino } = statSync(fileName);
  return readdirSync('/dev/fd').filter((descriptor) => opensTheFile(Number(descriptor), dev, ino)).length;
}

describe('a ledger on a database file', () => {
  it('closes every connection to the file when the runtime is disposed', async () => {
    const fileName = aDatabaseFile();
    const { ledger, dispose } = await openLedgerWith(ledgerLayer({ fileName }));
    await Effect.runPromise(Effect.all([ledger.execute(tallies, tally, [1]), ledger.load('org/acme/other', tally)]));
    const whileOpen = descriptorsOpenOn(fileName);

    await dispose();

    expect({ openBeforeDisposal: whileOpen > 0, openAfterDisposal: descriptorsOpenOn(fileName) }).toEqual({
      openBeforeDisposal: true,
      openAfterDisposal: 0,
    });
  });

  it('fails to build, with a defect, when its database cannot be opened', async () => {
    const fileName = dirname(aDatabaseFile());

    const cause = await failureToBuild(fileName);

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain('SQLITE_CANTOPEN: unable to open database file');
  });

  it('fails to build, with a defect, when the directory of its database cannot be created', async () => {
    const aFile = join(dirname(aDatabaseFile()), 'a-file');
    writeFileSync(aFile, '');

    const cause = await failureToBuild(join(aFile, 'ledger.db'));

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain('EEXIST: file already exists, mkdir');
  });
});

describe('a ledger on a database file given a floor of its own', () => {
  it('refuses a database of the layout below that floor as older than its floor, whatever the floor of the ledger', async () => {
    const fileName = aDatabaseFile();
    await aSQLiteFileInLayout(fileName, ledgerLayoutFloor - 2);

    const refused = await openLedgerWith(ledgerLayer({ fileName, floor: ledgerLayoutFloor - 1 })).catch(
      (error: unknown) => error,
    );

    expect(refused).toMatchObject({
      _tag: 'ledger_layout_refused',
      found: ledgerLayoutFloor - 2,
      floor: ledgerLayoutFloor - 1,
    });
  });
});

describe('two ledgers on one database file, as a server and a command run beside it', () => {
  it('never both append at one version: the one the other got ahead of decides again on what the other wrote', async () => {
    const fileName = aDatabaseFile();
    const server = await openLedgerWith(ledgerLayer({ fileName }));
    const command = await openLedgerWith(ledgerLayer({ fileName }));
    await Effect.runPromise(server.ledger.execute(tallies, tally, [1]));
    const serverTakesOneFirst = Effect.orDie(server.ledger.execute(tallies, tally, [-1]));

    const decided = await Effect.runPromise(
      command.ledger.execute(tallies, tallyInterruptedBy(serverTakesOneFirst, 1), [5]),
    );
    const loaded = await Effect.runPromise(server.ledger.load(tallies, tally));
    await Promise.all([server.dispose(), command.dispose()]);

    expect({ decided, loaded }).toEqual({
      decided: { state: 5, version: 3, decidedOn: 0 },
      loaded: { state: 5, version: 3 },
    });
  });
});

describe('a ledger on a database file in a directory that does not exist yet', () => {
  it('creates the directory and keeps what was written', async () => {
    const fileName = join(dirname(aDatabaseFile()), 'missing', 'deeper', 'ledger.db');
    const first = await openLedgerWith(ledgerLayer({ fileName }));
    await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
    await first.dispose();

    const second = await openLedgerWith(ledgerLayer({ fileName }));
    const reloaded = await Effect.runPromise(second.ledger.load(tallies, tally));
    await second.dispose();

    expect({ created: statSync(fileName).isFile(), reloaded }).toEqual({
      created: true,
      reloaded: { state: 5, version: 2 },
    });
  });
});

describe('a ledger in a private in-memory database', () => {
  it('shares nothing with another ledger in memory, and creates no directory for it', async () => {
    const first = await openLedgerWith(ledgerLayer({ fileName: ':memory:' }));
    await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
    const second = await openLedgerWith(ledgerLayer({ fileName: ':memory:' }));

    const loaded = await Effect.runPromise(
      Effect.all([first.ledger.load(tallies, tally), second.ledger.load(tallies, tally)]),
    );
    await Promise.all([first.dispose(), second.dispose()]);

    expect({ loaded, directory: existsSync(':memory:') }).toEqual({
      loaded: [
        { state: 5, version: 2 },
        { state: 0, version: 0 },
      ],
      directory: false,
    });
  });
});

describe('a ledger in a private in-memory database opened from the image of a ledger', () => {
  it('holds what the image holds, each ledger opened from it its own, and leaves the image as it was', async () => {
    const image = await imageOfALedgerHolding([2, 3]);
    const before = Buffer.from(image);
    const first = await openLedgerWith(sqliteLedgerFile(':memory:', image).ledgerLayer());
    await Effect.runPromise(first.ledger.execute(tallies, tally, [1]));
    const second = await openLedgerWith(sqliteLedgerFile(':memory:', image).ledgerLayer());

    const loaded = await Effect.runPromise(
      Effect.all([first.ledger.load(tallies, tally), second.ledger.load(tallies, tally)]),
    );
    await Promise.all([first.dispose(), second.dispose()]);

    expect(loaded).toEqual([
      { state: 6, version: 3 },
      { state: 5, version: 2 },
    ]);
    expect(Buffer.from(image).equals(before)).toBe(true);
  });

  it('is never what a ledger on a database file opens: it opens its file', async () => {
    const image = await imageOfALedgerHolding([2, 3]);
    const onAFile = await openLedgerWith(sqliteLedgerFile(aDatabaseFile(), image).ledgerLayer());

    const loaded = await Effect.runPromise(onAFile.ledger.load(tallies, tally));
    await onAFile.dispose();

    expect(loaded).toEqual({ state: 0, version: 0 });
  });
});
