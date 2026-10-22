import { stripVTControlCharacters } from 'node:util';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfAnotherVersion } from '../database/ledger-of-another-version.ts';
import type { ColorStream } from '../logging/terminal.ts';
import { startupFailureNoticeFor } from './failure-notice.ts';

const inAnotherLayout = { found: 2, kept: 1 };

const ledgerFileOfAnotherVersion = ledgerOfAnotherVersion(inAnotherLayout, {
  ledger: { store: 'sqlite', file: '/Users/ada/.auto-runtime/ledger.db' },
  distribution: 'npx',
});

const servicesFailed = new Error("The server's services could not start", { cause: ledgerFileOfAnotherVersion });

const notATerminal: ColorStream = {};

const aTerminalWithColors: ColorStream = { isTTY: true, getColorDepth: () => 24 };

describe('the notice that a server could not start on a ledger file of another version', () => {
  it('says where the ledger is and why it is refused, what to do with the command that does it, and where to ask, last', () => {
    expect(startupFailureNoticeFor(notATerminal)(servicesFailed)?.split('\n')).toEqual([
      '  ✖ Auto Runtime could not start',
      '',
      '  The ledger is kept in the file /Users/ada/.auto-runtime/ledger.db, and was',
      '  made by another version of Auto Runtime. This version keeps the ledger in',
      '  layout 1 and cannot read a ledger in layout 2.',
      '',
      '  What you can do',
      '    Delete the ledger and start Auto Runtime again. Everything in the ledger',
      '    goes with it, every playbook, definition, run and connection among it.',
      '',
      '      rm -f /Users/ada/.auto-runtime/ledger.db /Users/ada/.auto-runtime/ledger.db-wal /Users/ada/.auto-runtime/ledger.db-shm',
      '',
      '  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
    ]);
  });

  it('marks the failure in red, sets the command apart in cyan and links Discord where stderr is a terminal with colors', () => {
    const notice = String(startupFailureNoticeFor(aTerminalWithColors)(ledgerFileOfAnotherVersion));

    expect(notice).toContain('\u001B[31m✖\u001B[39m');
    expect(notice).toContain(
      '\u001B[36mrm -f /Users/ada/.auto-runtime/ledger.db /Users/ada/.auto-runtime/ledger.db-wal /Users/ada/.auto-runtime/ledger.db-shm\u001B[39m',
    );
    expect(notice).toContain('\u001B]8;;https://discord.gg/B8BKcKMRm8\u001B\\');
    expect(stripVTControlCharacters(notice)).toBe(startupFailureNoticeFor(notATerminal)(servicesFailed));
  });

  it('leaves any other failure to the line that names it', () => {
    expect([
      startupFailureNoticeFor(aTerminalWithColors)(new Error('listen EADDRINUSE: address already in use :::5555')),
      startupFailureNoticeFor(aTerminalWithColors)('a failure that is no error'),
    ]).toEqual([undefined, undefined]);
  });
});

describe('the notice that a server in the image could not start on a ledger file of another version', () => {
  it('says which files to delete from the volume, or to remove the volume, with no command', () => {
    const inTheImage = ledgerOfAnotherVersion(inAnotherLayout, {
      ledger: { store: 'sqlite', file: '/app/data/ledger.db' },
      distribution: 'docker',
    });

    expect(startupFailureNoticeFor(notATerminal)(inTheImage)?.split('\n').slice(6, 13)).toEqual([
      '  What you can do',
      '    Delete ledger.db, ledger.db-wal and ledger.db-shm from the volume',
      "    mounted at /data, the ledger's folder /app/data in the image, or remove",
      '    the volume, and start Auto Runtime again. Everything in the ledger goes',
      '    with it, every playbook, definition, run and connection among it.',
      '',
      '  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
    ]);
  });
});

describe('the notice that a server could not start on a ledger in PostgreSQL of another version', () => {
  it('says to point DATABASE_URL at an empty database, with no command', () => {
    const inPostgreSQL = ledgerOfAnotherVersion(inAnotherLayout, {
      ledger: {
        store: 'postgresql',
        url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
        host: 'db.example.com:5432',
        database: 'auto_runtime',
        credentials: { kind: 'url' },
      },
      distribution: 'npx',
    });

    expect(startupFailureNoticeFor(notATerminal)(inPostgreSQL)?.split('\n').slice(2)).toEqual([
      '  The ledger is kept in PostgreSQL, in the database auto_runtime on',
      '  db.example.com:5432, and was made by another version of Auto Runtime. This',
      '  version keeps the ledger in layout 1 and cannot read a ledger in layout 2.',
      '',
      '  What you can do',
      '    Point DATABASE_URL at an empty database, or empty this one, and start',
      '    Auto Runtime again. The ledger then starts with no playbooks,',
      '    definitions or runs.',
      '',
      '  Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8',
    ]);
  });
});
