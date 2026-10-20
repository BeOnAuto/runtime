import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { homeOfTheTest, spawnRuntimeCommand, type RuntimeCommandRun } from '../testing/processes/runtime-command.ts';
import { pingsRecordedInto, startPingOf } from '../testing/records/recorded-pings.ts';
import { until } from '../testing/waiting/until.ts';
import { firstStartNotice } from './usage-ping.ts';

async function readyIn(run: RuntimeCommandRun): Promise<void> {
  await until(run.stdout, (text) => text.includes('Press Ctrl+C to stop.'));
}

async function landingPageAt(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' } });
  return response.text();
}

describe('the auto-runtime command of the npm package', () => {
  it('pings at each start with the install in its home, says so once in its ready notice, and names the install to Studio', async () => {
    const home = homeOfTheTest('auto-runtime-usage-ping-');
    const port = await aPortNothingListensOn();
    const pings = pingsRecordedInto(home);
    const settings = { RUNTIME_DISTRIBUTION: 'npx', ...pings.settings };

    const first = spawnRuntimeCommand([], { home, port, settings });
    await readyIn(first);
    const page = await landingPageAt(port);
    first.interrupt();
    await first.exited;
    const second = spawnRuntimeCommand([], { home, port, settings });
    await readyIn(second);
    second.interrupt();
    await second.exited;

    const install = readFileSync(join(home, '.auto-runtime', 'install-id'), 'utf8').trim();
    expect(pings.urls()).toEqual([startPingOf('npx', install), startPingOf('npx', install)]);
    expect(first.stdout()).toContain(`\n  ${firstStartNotice}\n\n  Press Ctrl+C to stop.\n`);
    expect(second.stdout()).not.toContain(firstStartNotice);
    expect(page).toContain(`&amp;src=runtime-page&amp;install=${install}"`);
  });
});
