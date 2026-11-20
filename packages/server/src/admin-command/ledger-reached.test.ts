import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  aLedgerOfAnEarlierVersionAt,
  aLedgerOfANewerVersionAt,
} from '../testing/records/a-ledger-of-another-version.ts';
import { aLedgerAServerKeptAt, shippedFilesOfTheServer } from '../testing/records/ledger-a-server-kept.ts';
import { everyRowSet, onTheLedgerIn, rowsOfTheLedgerIn, tableDropped } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { ledgerRead, out } from './admin-words.ts';
import { ledgerFoundIn } from './ledger-reached.ts';
import { withTheLedgerOpened } from './opened-for-a-command.ts';

const ledgers: TemporaryLedger[] = [];

afterEach(() => {
  for (const { remove } of ledgers.splice(0)) {
    remove();
  }
});

function aLedgerFile(): string {
  const ledger = temporaryLedger();
  ledgers.push(ledger);
  return ledger.fileName;
}

interface Opening {
  readonly said: Awaited<ReturnType<typeof withTheLedgerOpened>>;
  readonly used: boolean;
}

async function openedBy(file: string): Promise<Opening> {
  const used = { opened: false };
  const said = await withTheLedgerOpened(readSettingsOf({ LEDGER_FILE: file }), shippedFilesOfTheServer, () => {
    used.opened = true;
    return Promise.resolve(out());
  });
  return { said, used: used.opened };
}

function layoutOf(file: string): Promise<readonly unknown[]> {
  return rowsOfTheLedgerIn(file, 'ledger_layout');
}

describe('a ledger the admin commands do not open', () => {
  it('is one that is not there: the command makes none in its place', async () => {
    const file = aLedgerFile();

    expect(await openedBy(file)).toMatchObject({ said: { said: 'refused' }, used: false });
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    ['an earlier version', aLedgerOfAnEarlierVersionAt],
    ['a newer version', aLedgerOfANewerVersionAt],
  ])('is one of %s, which the command leaves in the layout it found, carrying nothing forward', async (_case, made) => {
    const file = aLedgerFile();
    await made(file);
    const before = await layoutOf(file);

    expect(await openedBy(file)).toMatchObject({ said: { said: 'refused', lines: [expect.any(String)] }, used: false });
    expect(await layoutOf(file)).toEqual(before);
  });

  it('is one whose layout number is gone, or whose sign-in tables a newer version made', async () => {
    const [noLayout, newerSignIn] = [aLedgerFile(), aLedgerFile()];
    await aLedgerAServerKeptAt({ LEDGER_FILE: noLayout }, () => Promise.resolve());
    await aLedgerAServerKeptAt({ LEDGER_FILE: newerSignIn }, () => Promise.resolve());
    await onTheLedgerIn(noLayout, (connection) => connection.write(tableDropped('ledger_layout')));
    await onTheLedgerIn(newerSignIn, (connection) => connection.write(everyRowSet('auth_layout', { layout: 99 })));

    expect(await Promise.all([openedBy(noLayout), openedBy(newerSignIn)])).toMatchObject([
      { said: { said: 'refused' }, used: false },
      { said: { said: 'refused' }, used: false },
    ]);
  });
});

describe('a ledger kept in PostgreSQL', () => {
  it('is looked for by no file, and named by its setting, never by its address, which can hold a password', () => {
    const { ledger } = readSettingsOf({
      DATABASE_URL: 'postgresql://auto:a-password-of-the-test@db.example.com:5432/auto',
      SECRETS_KEY: Buffer.alloc(32).toString('base64'),
    });

    expect(() => {
      ledgerFoundIn(ledger);
    }).not.toThrow();
    expect(ledgerRead(ledger)).not.toMatch(/a-password-of-the-test|db\.example\.com/u);
  });
});
