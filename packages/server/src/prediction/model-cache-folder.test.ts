import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger;
}

function serverOn(ledger: TemporaryLedger) {
  return spawnServer(mainModule, {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    PREDICTION_CACHE_DIR: ledger.cacheDirectory,
  });
}

describe('the folder of the model files', () => {
  it('stops the server from starting when users other than its owner may write to it, naming the setting', async () => {
    const ledger = aLedger();
    mkdirSync(ledger.cacheDirectory);
    chmodSync(ledger.cacheDirectory, 0o777);

    const child = serverOn(ledger);

    expect(await child.exited).toBe(1);
    expect(child.output().stderr).toContain(
      `Auto Runtime could not start: InvalidSettingsError: The prediction function settings are invalid. PREDICTION_CACHE_DIR: ${ledger.cacheDirectory} may be written by users other than its owner; name a folder that only the server's user may write to`,
    );
  });

  it('is made by the server as it starts, readable by its own user alone, before it keeps any model file', async () => {
    const ledger = aLedger();
    const child = serverOn(ledger);
    await child.port;
    const made = statSync(ledger.cacheDirectory);
    child.signal('SIGTERM');
    await child.exited;

    expect([made.isDirectory(), made.mode & 0o777]).toEqual([true, 0o700]);
  });

  it('is left unread at start, so the files in it are checked against their digests when a prediction first needs them', async () => {
    const ledger = aLedger();
    const entry = join(ledger.cacheDirectory, 'models', 'a'.repeat(64));
    mkdirSync(entry, { recursive: true, mode: 0o700 });
    chmodSync(ledger.cacheDirectory, 0o700);
    writeFileSync(join(entry, 'model.onnx'), 'not the bytes of its digest');

    const child = serverOn(ledger);
    await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(existsSync(join(entry, 'model.onnx'))).toBe(true);
  });
});
