import { existsSync, fstatSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Ledger, textToKeep } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Cause, Effect } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayer } from './sqlite3.ts';
import { openChoresWith, openLedgerWith } from './testing/open-ledger.ts';
import { tally } from './testing/tally.ts';
import { temporaryDatabase, type TemporaryDatabase } from './testing/temporary-database.ts';

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

describe('a ledger given a content store of its own', () => {
  it('keeps its content there, reads it back from there, and sweeps that store when its chore is called', async () => {
    const content = memoryRecordedContent();
    const swept = Promise.withResolvers<number>();
    const { ledger, sweptAt, dispose } = await openChoresWith(
      ledgerLayer({
        fileName: ':memory:',
        content: {
          content,
          sweepContent: (before) => {
            swept.resolve(before);
            return Promise.resolve();
          },
        },
      }),
    );
    onTestFinished(dispose);
    const alpha = { org: 'acme', playbook: 'alpha' };

    const kept = await Effect.runPromise(ledger.content.put(alpha, textToKeep('{}', 'application/json')));
    const held = await Effect.runPromise(content.get(alpha, kept.sha256));

    expect(held).toMatchObject({ bytes: 2, mediaType: 'application/json' });
    expect(await Effect.runPromise(ledger.content.get(alpha, kept.sha256))).toMatchObject({ bytes: 2 });
    await sweptAt(Date.now());
    expect(await swept.promise).toBeLessThan(Date.now());
  });
});
