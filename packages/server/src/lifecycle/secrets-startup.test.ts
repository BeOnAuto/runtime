import { chmodSync, statSync, writeFileSync } from 'node:fs';
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

function kidOf(key: Readonly<Uint8Array>): string {
  return sha256Of(key).slice(0, 16);
}

function aLedgerFile(): string {
  const { fileName, remove } = temporaryLedger();
  onTestFinished(remove);
  return fileName;
}

async function secretsKeptIn(fileName: string, values: readonly string[]): Promise<void> {
  const store = await secretStoreInFile(fileName, previousKey);
  await Effect.runPromise(Effect.forEach(values, (value) => store.keep(Redacted.make(value))));
  await store.close();
}

async function secretsLinesOf(environment: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const child = spawnServer(mainModule, { ...loopback, ...environment });
  await child.port;
  child.signal('SIGTERM');
  await child.exited;
  return child
    .output()
    .stderr.split('\n')
    .filter((line) => line.includes('ecret'));
}

describe('the secret store as the server starts', () => {
  it('logs the key its secrets are sealed under and how many it re-sealed from the previous key, and nothing more', async () => {
    const fileName = aLedgerFile();
    await secretsKeptIn(fileName, ['pasted-key-1', 'pasted-key-2']);

    const lines = await secretsLinesOf({
      LEDGER_FILE: fileName,
      SECRETS_KEY: currentKey.toString('base64'),
      SECRETS_KEY_PREVIOUS: previousKey.toString('base64'),
    });

    expect(lines).toEqual([
      expect.stringContaining(
        `{"message":"Secrets are kept sealed under the key ${kidOf(currentKey)}, and 2 sealed under the previous key were sealed again under it","level":"INFO"`,
      ),
    ]);
    expect(lines[0]).toContain(`"annotations":{"secrets_kid":"${kidOf(currentKey)}","secrets_resealed":2}`);
    expect(lines.join('\n')).not.toMatch(/pasted-key|AQEBAQ|AgICAg/u);
  });

  it('makes a key file beside the ledger at the first start, only its owner may read, and seals under it again at the next', async () => {
    const fileName = aLedgerFile();
    const keyFile = join(fileName, '..', 'secrets.key');

    const first = messagesOf((await secretsLinesOf({ LEDGER_FILE: fileName })).join('\n'));
    const second = messagesOf((await secretsLinesOf({ LEDGER_FILE: fileName })).join('\n'));

    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });
});

describe('a server whose secrets key cannot be had', () => {
  it('stops the process at start when the key file beside the ledger may be read by others, naming the file', async () => {
    const fileName = aLedgerFile();
    const keyFile = join(fileName, '..', 'secrets.key');
    writeFileSync(keyFile, currentKey.toString('base64'), { mode: 0o600 });
    chmodSync(keyFile, 0o640);

    const child = spawnServer(mainModule, { ...loopback, LEDGER_FILE: fileName });

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n').slice(-2)).toEqual([
      `Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid. The key file ${keyFile} has the mode 0640, so others than its owner may read it; set it to 0600`,
      '',
    ]);
  });

  it('stops the process at start for a ledger in PostgreSQL without SECRETS_KEY, naming the setting and no URL', async () => {
    const child = spawnServer(mainModule, {
      ...loopback,
      DATABASE_URL: 'postgresql://playbooks:a-secret-password@db.example.com/playbooks',
    });

    expect(await child.exited).toBe(1);
    expect(child.output()).toEqual({
      stdout: '',
      stderr:
        'Auto Runtime could not start: InvalidSettingsError: The secrets settings are invalid. SECRETS_KEY: Set it when the ledger is kept in PostgreSQL, since a database that runtimes share needs a key kept on none of their disks\n',
    });
  });
});
