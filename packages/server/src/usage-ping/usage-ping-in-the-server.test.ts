import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { describe, expect, it, onTestFinished } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import {
  answered,
  folderOfTheTest,
  optionsPingingThrough,
  settingsIn,
  unanswered,
  type Pings,
} from '../testing/records/server-pings.ts';

async function landingPageOf(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' } });
  return response.text();
}

function abortOfTheFirst({ signals }: Pings): Promise<unknown> {
  const [first] = signals;
  return first === undefined ? Promise.reject(new Error('no usage ping was sent')) : once(first, 'abort');
}

describe('a server whose usage ping is on', () => {
  it('sends it once it listens, and names its install in the link of its page to Studio', async () => {
    const folder = folderOfTheTest();
    const pings = answered();

    const server = await startServer(settingsIn(folder), optionsPingingThrough(pings, folder));
    const page = await landingPageOf(server.port);
    await server.stop();

    const id = String(server.install?.id);
    expect(pings.urls.map((url) => new URL(url).searchParams.get('install'))).toEqual([id]);
    expect(server.install?.isNew).toBe(true);
    expect(page).toContain(`&amp;src=runtime-page&amp;install=${id}"`);
    expect(existsSync(join(folder, 'install-id'))).toBe(true);
  });

  it('gives up a ping still under way when it stops', async () => {
    const folder = folderOfTheTest();
    const pings = unanswered();

    const server = await startServer(settingsIn(folder), optionsPingingThrough(pings, folder));
    const aborted = abortOfTheFirst(pings);
    await server.stop();

    await expect(aborted).resolves.toEqual([expect.objectContaining({ type: 'abort' })]);
  });

  it('sends none, and makes no install, where it cannot listen', async () => {
    const folder = folderOfTheTest();
    const taken = await startServer(settingsIn(folder), defaultServerOptions);
    onTestFinished(() => taken.stop());
    const pings = answered();

    await expect(
      startServer(settingsIn(folder, { PORT: String(taken.port) }), optionsPingingThrough(pings, folder)),
    ).rejects.toThrow('EADDRINUSE');
    expect(pings.urls).toEqual([]);
    expect(existsSync(join(folder, 'install-id'))).toBe(false);
  });
});

describe('a server whose usage ping is off', () => {
  it.each<Environment>([{ DO_NOT_TRACK: '1' }, { SCARF_NO_ANALYTICS: 'true' }, { USAGE_PING: 'false' }])(
    'sends nothing, makes no install and names none to Studio with %o',
    async (environment) => {
      const folder = folderOfTheTest();
      const pings = answered();

      const server = await startServer(settingsIn(folder, environment), optionsPingingThrough(pings, folder));
      const page = await landingPageOf(server.port);
      await server.stop();

      expect(pings.urls).toEqual([]);
      expect(server.install).toBeUndefined();
      expect(existsSync(join(folder, 'install-id'))).toBe(false);
      expect(page).toContain('&amp;src=runtime-page"');
    },
  );
});
