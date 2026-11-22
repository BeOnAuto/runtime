import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { statement } from '@on.auto/ledger';
import { unreachableDatabase } from '@on.auto/ledger/testing';
import { authLayout } from '@on.auto/openid-connect/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerRefusalIn } from '../database/ledger-refusals.ts';
import { aFakePostgreSQL } from '../testing/databases/fake-postgresql.ts';
import { aCertificateOfTheLoopback, type LoopbackCertificate } from '../testing/databases/loopback-certificate.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { saidAtStart, startedInProcess } from '../testing/processes/in-process-starts.ts';
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
  anEarlierLayout,
  aNewerLayout,
} from '../testing/records/a-ledger-of-another-version.ts';
import { onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { startServer } from './lifecycle.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const couldNotStart = /^Auto Runtime could not start: [^\n]+\n$/u;

interface Directory {
  readonly path: string;
  readonly fileOf: (name: string) => string;
}

function aDirectory(): Directory {
  const path = mkdtempSync(join(tmpdir(), 'auto-runtime-signed-ledger-'));
  onTestFinished(() => {
    rmSync(path, { recursive: true, force: true });
  });
  return { path, fileOf: (name) => join(path, name) };
}

function trustedByAServer({ cert }: LoopbackCertificate, directory: Directory): string {
  const authorities = directory.fileOf('authorities.pem');
  writeFileSync(authorities, cert);
  return authorities;
}

describe('a ledger in PostgreSQL that cannot be reached', () => {
  it('stops start-up with a named error that gives the address and no credential', async () => {
    const { url, port, password } = await unreachableDatabase();

    const failure = await startServer(
      { HOST: '127.0.0.1', PORT: '0', DATABASE_URL: url, SECRETS_KEY: secretsKey },
      testComposition(),
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

describe('a ledger file whose sign-in tables a newer version of Auto Runtime carried forward', () => {
  it('stops start-up with the refusal of a newer version, which the start-up line and notice say, and leaves the tables as they were', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const settings = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName };
    await (await startedInProcess(settings)).stop();
    await onTheLedgerIn(ledger.fileName, (connection) =>
      connection.write(statement`UPDATE auth_layout SET layout = ${authLayout + 1}`),
    );

    const failure: unknown = await startedInProcess(settings).then(
      (server) => server.stop(),
      (refused: unknown) => refused,
    );

    expect(failure).toMatchObject({ _tag: 'SignInStoreOfANewerVersion', found: authLayout + 1, kept: authLayout });
    expect(ledgerRefusalIn(failure)).toBe(failure);
    expect(
      await onTheLedgerIn(ledger.fileName, (connection) => connection.read(statement`SELECT layout FROM auth_layout`)),
    ).toEqual([{ layout: authLayout + 1 }]);
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
    const started = await startServer(
      { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: current.fileName },
      testComposition(),
    );
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

describe('a server given DATABASE_CREDENTIALS=aws-iam and a password in DATABASE_URL', () => {
  it('does not start, naming the setting and not the password', async () => {
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_CREDENTIALS: 'aws-iam',
      DATABASE_URL: 'postgresql://playbooks:a-secret-password@ledger.c9akciq32.eu-west-1.rds.amazonaws.com/playbooks',
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'Auto Runtime could not start: InvalidSettingsError: The ledger settings are invalid. DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the password is a token signed for each connection, so the URL holds none\n',
    });
  });
});

describe('a server given DATABASE_CREDENTIALS=aws-iam whose credential chain finds no credentials', () => {
  it('does not start, naming the error of the chain, once it has reached the database over TLS', async () => {
    const certificate = aCertificateOfTheLoopback();
    const database = await aFakePostgreSQL(certificate);
    const directory = aDirectory();

    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_CREDENTIALS: 'aws-iam',
      DATABASE_URL: `postgresql://auto_runtime@127.0.0.1:${database.port}/playbooks`,
      SECRETS_KEY: secretsKey,
      AWS_REGION: 'eu-west-1',
      NODE_EXTRA_CA_CERTS: trustedByAServer(certificate, directory),
      AWS_SHARED_CREDENTIALS_FILE: directory.fileOf('no-credentials'),
      AWS_CONFIG_FILE: directory.fileOf('no-config'),
      AWS_EC2_METADATA_DISABLED: 'true',
    });

    expect(await child.exited).toBe(1);
    expect(child.output().stderr).toMatch(
      /^Auto Runtime could not start: StartupError: The server's services could not start: .*Could not load credentials from any providers/u,
    );
    expect(database.askedForTls()).toBe(1);
    expect(database.passwords()).toEqual([]);
  });
});
