import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Of } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { messagesOf } from '../testing/processes/stderr-lines.ts';
import { secretStoreInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0' };

const previousKey = Buffer.alloc(32, 1);

const currentKey = Buffer.alloc(32, 2);

const valuesKept = ['pasted-key-1', 'pasted-key-2'];

const keysGiven = [previousKey.toString('base64'), currentKey.toString('base64')];

function kidOf(key: Readonly<Uint8Array>): string {
  return sha256Of(key).slice(0, 16);
}

function secretsIn(stderr: string, keysMade: readonly string[] = []): readonly string[] {
  return [...valuesKept, ...keysGiven, ...keysMade].filter((secret) => stderr.includes(secret));
}

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

function keyFileBeside(ledgerFile: string, name: string, key: Readonly<Uint8Array>): string {
  const file = join(ledgerFile, '..', name);
  writeFileSync(file, `${Buffer.from(key).toString('base64')}\n`, { mode: 0o600 });
  return file;
}

async function secretsKeptIn(fileName: string): Promise<void> {
  const store = await secretStoreInFile(fileName, previousKey);
  await Effect.runPromise(Effect.forEach(valuesKept, (value) => store.keep(Redacted.make(value))));
  await store.close();
}

async function startedWith(environment: Readonly<Record<string, string>>): Promise<string> {
  const child = spawnServer(mainModule, { ...loopback, ...environment });
  await child.port;
  child.signal('SIGTERM');
  await child.exited;
  return child.output().stderr;
}

function secretsLinesIn(stderr: string): readonly string[] {
  return stderr.split('\n').filter((line) => line.includes('ecret'));
}

function lineOf(kid: string, heldBy: string, rewrapped: number): string {
  return `{"message":"Secrets are kept in the ledger's database, sealed under the key ${kid} ${heldBy}, and ${rewrapped} sealed under the previous key were sealed again under it","level":"INFO"`;
}

describe('the secret store as the server starts', () => {
  it('logs the key its secrets are sealed under, that SECRETS_KEY holds, and how many SECRETS_KEY_PREVIOUS sealed it wrapped again, and nothing more', async () => {
    const fileName = aLedgerFile();
    await secretsKeptIn(fileName);

    const stderr = await startedWith({
      LEDGER_FILE: fileName,
      SECRETS_KEY: currentKey.toString('base64'),
      SECRETS_KEY_PREVIOUS: previousKey.toString('base64'),
    });
    const lines = secretsLinesIn(stderr);

    expect(lines).toEqual([expect.stringContaining(lineOf(kidOf(currentKey), 'that SECRETS_KEY holds', 2))]);
    expect(lines[0]).toContain(
      `"annotations":{"secrets_kid":"${kidOf(currentKey)}","secrets_resealed":2,"secrets_key_from":"environment"}`,
    );
    expect(secretsIn(stderr)).toEqual([]);
  });
});

describe('the secret store as the server starts with a key in a file', () => {
  it('logs the file SECRETS_KEY_FILE names, read as it is mounted, and wraps again what the key in the file of SECRETS_KEY_FILE_PREVIOUS sealed', async () => {
    const fileName = aLedgerFile();
    await secretsKeptIn(fileName);
    const [mounted, replaced] = [
      keyFileBeside(fileName, 'mounted.key', currentKey),
      keyFileBeside(fileName, 'replaced.key', previousKey),
    ];
    chmodSync(mounted, 0o644);
    chmodSync(replaced, 0o444);

    const stderr = await startedWith({
      LEDGER_FILE: fileName,
      SECRETS_KEY_FILE: mounted,
      SECRETS_KEY_FILE_PREVIOUS: replaced,
    });
    const again = await startedWith({ LEDGER_FILE: fileName, SECRETS_KEY_FILE: mounted });
    const lines = secretsLinesIn(stderr);

    expect(lines).toEqual([expect.stringContaining(lineOf(kidOf(currentKey), `that the file ${mounted} holds`, 2))]);
    expect(lines[0]).toContain('"secrets_key_from":"file"');
    expect(secretsLinesIn(again)).toEqual([
      expect.stringContaining(lineOf(kidOf(currentKey), `that the file ${mounted} holds`, 0)),
    ]);
    expect(secretsIn(`${stderr}${again}`)).toEqual([]);
  });

  it('makes a key file beside the ledger at the first start, only its owner may read, names it, and seals under it again at the next', async () => {
    const fileName = aLedgerFile();
    const keyFile = join(fileName, '..', 'secrets.key');

    const first = await startedWith({ LEDGER_FILE: fileName });
    const keyMade = readFileSync(keyFile, 'utf8').trim();
    const second = await startedWith({ LEDGER_FILE: fileName });

    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(messagesOf(secretsLinesIn(first).join('\n'))).toEqual([
      expect.stringContaining(`that the file ${keyFile} holds, and 0 sealed`),
    ]);
    expect(messagesOf(secretsLinesIn(second).join('\n'))).toEqual(messagesOf(secretsLinesIn(first).join('\n')));
    expect(keyMade).toHaveLength(44);
    expect(secretsIn(`${first}${second}`, [keyMade])).toEqual([]);
  });
});

async function refusedStart(environment: Readonly<Record<string, string>>): Promise<string> {
  const child = spawnServer(mainModule, { ...loopback, ...environment });
  expect(await child.exited).toBe(1);
  expect(child.output().stdout).toBe('');
  return child.output().stderr;
}

function lastLinesOf(stderr: string): readonly string[] {
  return stderr.split('\n').slice(-2);
}

const refusedAs = 'Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid.';

describe('a server whose secrets key cannot be had', () => {
  it('stops the process at start when the key file beside the ledger may be read by others, naming the setting and the file', async () => {
    const fileName = aLedgerFile();
    const keyFile = keyFileBeside(fileName, 'secrets.key', currentKey);
    chmodSync(keyFile, 0o640);

    const stderr = await refusedStart({ LEDGER_FILE: fileName });

    expect(lastLinesOf(stderr)).toEqual([
      `${refusedAs} SECRETS_KEY_FILE: The key file ${keyFile} has the mode 0640, so others than its owner may read it; set it to 0600`,
      '',
    ]);
    expect(secretsIn(stderr)).toEqual([]);
  });

  it('stops the process at start for a file SECRETS_KEY_FILE names that does not exist, and makes none', async () => {
    const fileName = aLedgerFile();
    const keyFile = join(fileName, '..', 'mounted.key');

    const stderr = await refusedStart({ LEDGER_FILE: fileName, SECRETS_KEY_FILE: keyFile });

    expect(lastLinesOf(stderr)).toEqual([
      `${refusedAs} SECRETS_KEY_FILE: The key file ${keyFile} does not exist, and a key file a setting names is read, never made`,
      '',
    ]);
    expect(existsSync(keyFile)).toBe(false);
    expect(secretsIn(stderr)).toEqual([]);
  });
});

describe('a server given its secrets keys in more places than one', () => {
  it('stops the process at start for two previous keys, naming both settings and never a key', async () => {
    const fileName = aLedgerFile();

    const stderr = await refusedStart({
      LEDGER_FILE: fileName,
      SECRETS_KEY: currentKey.toString('base64'),
      SECRETS_KEY_PREVIOUS: previousKey.toString('base64'),
      SECRETS_KEY_FILE_PREVIOUS: keyFileBeside(fileName, 'replaced.key', previousKey),
    });

    expect(lastLinesOf(stderr)).toEqual([
      `${refusedAs} SECRETS_KEY_PREVIOUS: Set SECRETS_KEY_PREVIOUS or SECRETS_KEY_FILE_PREVIOUS, not both`,
      '',
    ]);
    expect(secretsIn(stderr)).toEqual([]);
  });

  it('stops the process at start for a ledger in PostgreSQL without SECRETS_KEY or SECRETS_KEY_FILE, naming both and no URL', async () => {
    const stderr = await refusedStart({
      DATABASE_URL: 'postgresql://playbooks:a-secret-password@db.example.com/playbooks',
    });

    expect(stderr).toBe(
      `${refusedAs} SECRETS_KEY: Set it, or SECRETS_KEY_FILE, when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks\n`,
    );
  });
});
