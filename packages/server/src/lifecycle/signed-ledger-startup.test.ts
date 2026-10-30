import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

import { aFakePostgreSQL } from '../testing/databases/fake-postgresql.ts';
import { aCertificateOfTheLoopback, type LoopbackCertificate } from '../testing/databases/loopback-certificate.ts';
import { secretsKey } from '../testing/databases/secrets-key.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

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
