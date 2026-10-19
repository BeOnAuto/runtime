import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { fakeStudioHost, studioPage } from '../testing/studios/fake-studio-host.ts';
import { until } from '../testing/waiting/until.ts';
import { markerName } from './kept-answers.ts';
import { studioFolderName } from './served-studio.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

function aFolderForStudio(): { readonly ledgerFile: string; readonly folder: string } {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  const folder = join(dirname(ledger.fileName), studioFolderName);
  mkdirSync(folder, { mode: 0o700 });
  return { ledgerFile: ledger.fileName, folder };
}

describe('a runtime whose folder for Studio holds a file it did not write', () => {
  it('serves Studio from memory, leaves the folder as it is, and warns, saying why', async () => {
    const host = await fakeStudioHost();
    onTestFinished(() => host.close());
    const { ledgerFile, folder } = aFolderForStudio();
    writeFileSync(join(folder, markerName), '');
    writeFileSync(join(folder, 'notes.txt'), 'the notes of the operator');
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledgerFile,
      STUDIO_ORIGIN: host.origin,
    });

    const response = await fetch(`http://127.0.0.1:${await child.port}/studio/`);
    const page = await response.text();
    await until(
      () => child.output().stderr,
      (stderr) => stderr.includes('kept in memory alone'),
    );
    child.signal('SIGTERM');
    await child.exited;

    expect([response.status, page, readdirSync(folder).toSorted()]).toEqual([
      200,
      studioPage,
      [markerName, 'notes.txt'].toSorted(),
    ]);
    expect(child.output().stderr).toContain(
      `"message":"The Studio this runtime serves is kept in memory alone, since the folder ${folder} holds notes.txt, which Auto Runtime did not write there"`,
    );
  });
});
