import { fileURLToPath } from 'node:url';

import { unreachableDatabase } from '@on.auto/ledger/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { saidAtStart } from '../testing/processes/in-process-starts.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import {
  aFactInAnEarlierShape,
  aFactOfAnEarlierVersion,
  aFactOfAPredictionBuild,
  aLedgerHoldingAFactInAnEarlierShapeAt,
  aLedgerHoldingAFactOfAnEarlierVersionAt,
  aLedgerHoldingAPredictionBuildAt,
  aLedgerHoldingAPredictionRejectedAt,
  aLedgerOfAnEarlierVersionAt,
  aLedgerOfANewerVersionAt,
  aNewerLayout,
  anEarlierLayout,
} from '../testing/records/a-ledger-of-another-version.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { startServer } from './lifecycle.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const couldNotStart = /^Auto Runtime could not start: [^\n]+\n$/u;

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
    const said = await saidAtStart({
      LEDGER_FILE: '/data/ledger.db',
      DATABASE_URL: 'postgresql://playbooks:a-secret-password@db.example.com/playbooks',
    });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(/^Auto Runtime could not start: InvalidSettingsError: .*DATABASE_URL.*LEDGER_FILE/u);
    expect(said.line).not.toContain('a-secret-password');
  });
});

describe('a ledger file made by a newer version of Auto Runtime', () => {
  it('stops start-up with one line that names the file and both layouts, and deletes nothing', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfANewerVersionAt(ledger.fileName);
    const file = ledger.fileName;

    const said = await saidAtStart({ LEDGER_FILE: file });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(couldNotStart);
    expect(said.line).toContain(file);
    expect(said.line).toContain(`layout ${String(aNewerLayout)}`);
    expect(said.line).not.toContain('rm -f');
  });
});

describe('a ledger file made by an earlier version of Auto Runtime than this one carries forward', () => {
  it('stops start-up with one line that names the file and its layout, ending with the command that deletes it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfAnEarlierVersionAt(ledger.fileName);
    const file = ledger.fileName;

    const said = await saidAtStart({ LEDGER_FILE: file });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(couldNotStart);
    expect(said.line).toContain(`layout ${String(anEarlierLayout)}`);
    expect(said.line.endsWith(`rm -f ${file} ${file}-wal ${file}-shm\n`)).toBe(true);
  });
});

describe('a ledger file that holds facts this version of Auto Runtime does not read', () => {
  it('stops start-up before it reads the ledger when the ledger holds a fact of a type this version does not read, naming it', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingAFactOfAnEarlierVersionAt(ledger.fileName);

    const said = await saidAtStart({ LEDGER_FILE: ledger.fileName });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(couldNotStart);
    expect(said.line).toContain(aFactOfAnEarlierVersion);
  });

  it('stops start-up before it reads the ledger when the newest fact of a type it reads is in a shape it does not read, naming the fact', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingAFactInAnEarlierShapeAt(ledger.fileName);

    const said = await saidAtStart({ LEDGER_FILE: ledger.fileName });

    expect(said.exitCode).toBe(1);
    expect(said.line).toContain(aFactInAnEarlierShape.type);
  });
});

describe('a ledger file that holds what an earlier version of Auto Runtime recorded of prediction builds', () => {
  it('stops start-up before it reads the ledger when its newest fact is a version built, naming the type', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerHoldingAPredictionBuildAt(ledger.fileName);

    const said = await saidAtStart({ LEDGER_FILE: ledger.fileName });

    expect(said.exitCode).toBe(1);
    expect(said.line).toContain(aFactOfAPredictionBuild);
  });

  it('stops start-up when its newest rejected run names a kind of refusal of an earlier version, and starts where it names one of this version', async () => {
    const [earlier, current] = [temporaryLedger(), temporaryLedger()];
    onTestFinished(earlier.remove);
    onTestFinished(current.remove);
    await aLedgerHoldingAPredictionRejectedAt(earlier.fileName, 'model_process_busy');
    await aLedgerHoldingAPredictionRejectedAt(current.fileName, 'dataset_not_ready');

    const said = await saidAtStart({ LEDGER_FILE: earlier.fileName });
    const started = await startServer({ HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: current.fileName }, compositionRoot);
    await started.stop();

    expect(said.exitCode).toBe(1);
    expect(said.line).toContain('run_rejected');
  });
});

describe('a ledger file made by an earlier version of Auto Runtime, in the image', () => {
  it('names the files to delete from the volume, with no command', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await aLedgerOfAnEarlierVersionAt(ledger.fileName);

    const said = await saidAtStart({ LEDGER_FILE: ledger.fileName, RUNTIME_DISTRIBUTION: 'docker' });

    expect(said.exitCode).toBe(1);
    expect(said.line).toMatch(couldNotStart);
    expect(said.line).toContain('ledger.db-wal');
    expect(said.line).not.toContain('rm -f');
  });
});
