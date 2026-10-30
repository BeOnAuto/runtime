import { fileURLToPath } from 'node:url';

import { ledgerLayout, ledgerLayoutFloor, unreachableDatabase } from '@on.auto/ledger/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import {
  aFactInAnEarlierShape,
  aFactOfAnEarlierVersion,
  aLedgerHoldingAFactInAnEarlierShapeAt,
  aLedgerHoldingAFactOfAnEarlierVersionAt,
  aLedgerOfAnEarlierVersionAt,
  aLedgerOfANewerVersionAt,
  aNewerLayout,
  anEarlierLayout,
} from '../testing/records/a-ledger-of-another-version.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { startServer } from './lifecycle.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

describe('a ledger in PostgreSQL that cannot be reached', () => {
  it('stops start-up with a named error that gives the address and no credential', async () => {
    const { url, port, password } = await unreachableDatabase();

    const failure = await startServer(
      { HOST: '127.0.0.1', PORT: '0', DATABASE_URL: url, SECRETS_KEY: secretsKey },
      compositionRoot,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'StartupError' });
    expect(String(failure)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(String(failure)).not.toContain(password);
  });

  it('stops the process with the error on one line of stderr, without the URL', async () => {
    const { url, port, password } = await unreachableDatabase();

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', DATABASE_URL: url, SECRETS_KEY: secretsKey });

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Auto Runtime could not start: StartupError: The server's services could not start: .*ECONNREFUSED 127\\.0\\.0\\.1:${port}`,
          'u',
        ),
      ),
      '',
    ]);
    expect(child.output().stderr).not.toContain(password);
  });
});

describe('a server given both DATABASE_URL and LEDGER_FILE', () => {
  it('does not start, naming both settings and neither value', async () => {
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: '/data/ledger.db',
      DATABASE_URL: 'postgresql://playbooks:a-secret-password@db.example.com/playbooks',
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'Auto Runtime could not start: InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: Set DATABASE_URL or LEDGER_FILE, not both\n',
    });
  });
});

function refusedFor(file: string): string {
  return `Auto Runtime could not start: The ledger is kept in the file ${file}, and was made by an earlier version of Auto Runtime, whose ledger this version does not carry forward. This version keeps the ledger in layout ${ledgerLayout} and carries forward a ledger in layout ${ledgerLayoutFloor} or later, so it cannot read a ledger in layout ${anEarlierLayout}.`;
}

const goesWithIt = 'Everything in the ledger goes with it, every playbook, definition, run and connection among it.';

const askedAt = 'Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8';

describe('a ledger file made by a newer version of Auto Runtime', () => {
  it('stops the process with one line of stderr that says upgrades go forward only and what to do, and deletes nothing', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfANewerVersionAt(ledger.fileName);
    const file = ledger.fileName;

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: file });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: `Auto Runtime could not start: The ledger is kept in the file ${file}, and was made by a newer version of Auto Runtime. This version keeps the ledger in layout ${ledgerLayout} and cannot read a ledger in layout ${aNewerLayout}: upgrades go forward only. Start the version of Auto Runtime that made the ledger, or a later one. To go back to this version, restore the backup taken before the upgrade. ${askedAt}\n`,
    });
  });
});

describe('a ledger file made by an earlier version of Auto Runtime than this one carries forward', () => {
  it('stops the process with one line of stderr, its words alone, that says where the ledger is, what to do and where to ask, ending with the command that deletes it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfAnEarlierVersionAt(ledger.fileName);
    const file = ledger.fileName;

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: file });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: `${refusedFor(file)} Delete the ledger and start Auto Runtime again. ${goesWithIt} ${askedAt} To delete the ledger, run: rm -f ${file} ${file}-wal ${file}-shm\n`,
    });
  });
});

describe('a ledger file that holds facts this version of Auto Runtime does not read', () => {
  it('stops the process before it reads the ledger when the ledger holds a fact of a type this version does not read, naming it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingAFactOfAnEarlierVersionAt(ledger.fileName);
    const file = ledger.fileName;

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: file });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: `Auto Runtime could not start: The ledger is kept in the file ${file}, and holds facts of the type ${aFactOfAnEarlierVersion}, which this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward. If a newer version of Auto Runtime made the ledger, start that version or a later one, or restore the backup taken before the upgrade. A ledger an earlier version made is not carried forward: Delete the ledger and start Auto Runtime again. ${goesWithIt} ${askedAt} To delete the ledger, run: rm -f ${file} ${file}-wal ${file}-shm\n`,
    });
  });

  it('stops the process before it reads the ledger when the newest fact of a type it reads is in a shape it does not read, naming the fact and its position', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingAFactInAnEarlierShapeAt(ledger.fileName);

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName });

    expect(await child.exited).toBe(1);
    expect(child.output().stderr).toContain(
      `, and holds the fact ${aFactInAnEarlierShape.type} at position 1, in a shape this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward.`,
    );
  });
});

describe('a ledger file made by an earlier version of Auto Runtime, in the image', () => {
  it('says in the image which files to delete from the volume, with no command', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfAnEarlierVersionAt(ledger.fileName);

    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      RUNTIME_DISTRIBUTION: 'docker',
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: `${refusedFor(ledger.fileName)} Delete ledger.db, ledger.db-wal and ledger.db-shm from the volume that holds ${ledger.directory}, or remove the volume, and start Auto Runtime again. ${goesWithIt} ${askedAt}\n`,
    });
  });
});
