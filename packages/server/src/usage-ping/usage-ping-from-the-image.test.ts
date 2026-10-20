import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { homeOfTheTest } from '../testing/processes/runtime-command.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { pingsRecordedInto, startPingOf } from '../testing/records/recorded-pings.ts';
import { until } from '../testing/waiting/until.ts';
import { firstStartNotice } from './usage-ping.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

describe('the server the image runs', () => {
  it('sends one usage ping naming the image and the install kept beside the ledger, and says so after its port at the first start', async () => {
    const folder = homeOfTheTest('auto-runtime-usage-ping-');
    const pings = pingsRecordedInto(folder);
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: join(folder, 'ledger.db'),
      RUNTIME_DISTRIBUTION: 'docker',
      ...pings.settings,
    });
    const port = await child.port;
    await until(pings.urls, (urls) => urls.length === 1);
    child.signal('SIGTERM');
    await child.exited;

    const install = readFileSync(join(folder, 'install-id'), 'utf8').trim();
    expect(pings.urls()).toEqual([startPingOf('docker', install)]);
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n${firstStartNotice}\n`);
  });

  it('sends none, and makes no install, with DO_NOT_TRACK', async () => {
    const folder = homeOfTheTest('auto-runtime-usage-ping-');
    const pings = pingsRecordedInto(folder);
    const child = spawnServer(mainModule, {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: join(folder, 'ledger.db'),
      ...pings.settings,
      DO_NOT_TRACK: '1',
    });
    const port = await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(pings.urls()).toEqual([]);
    expect(existsSync(join(folder, 'install-id'))).toBe(false);
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
  });
});
