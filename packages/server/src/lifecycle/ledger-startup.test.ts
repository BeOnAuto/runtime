import { fileURLToPath } from 'node:url';

import { unreachableDatabase } from '@on.auto/ledger/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { aLedgerOfAnotherVersionAt } from '../testing/records/ledger-of-another-version.ts';
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

describe('a ledger file made by another version of Auto Runtime', () => {
  it('stops the process with one line of stderr that says where the ledger is, what to do and where to ask, ending with the command that deletes it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    aLedgerOfAnotherVersionAt(ledger.fileName);

    const child = spawnServer(mainModule, { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr: `Auto Runtime could not start: StartupError: The server's services could not start: LedgerOfAnotherVersion: The ledger at ${ledger.fileName} was made by another version of Auto Runtime. This version keeps secrets in a different shape, and it does not yet carry a ledger over from one version to the next. kept_secrets has the columns held, id, kept_at, kept_by, version, where this version keeps claimed_until, ends_with, held, id, kept_at, kept_by, kid, version, wrapped_key. Delete the ledger and start Auto Runtime again. Every playbook, definition and run it holds goes with it, so if it holds work you want to keep, ask us before you delete it. Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8 To delete the ledger, run: rm -f ${ledger.fileName}{,-wal,-shm}\n`,
    });
  });
});
