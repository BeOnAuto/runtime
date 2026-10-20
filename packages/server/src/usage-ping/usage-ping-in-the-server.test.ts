import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { defaultServerOptions, startServer, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { runServer } from '../lifecycle/run-server.ts';
import { firstStartNotice, usagePingOf, type PingFetch } from './usage-ping.ts';

interface Pings {
  readonly fetch: PingFetch;
  readonly urls: readonly string[];
  readonly signals: readonly AbortSignal[];
}

function folderOfTheTest(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-usage-ping-server-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function recorded(answer: (signal: AbortSignal) => Promise<Response>): Pings {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  return {
    urls,
    signals,
    fetch: (url, { signal }) => {
      urls.push(url);
      signals.push(signal);
      return answer(signal);
    },
  };
}

function answered(): Pings {
  return recorded(() => Promise.resolve(new Response('')));
}

function unanswered(): Pings {
  return recorded(
    (signal) =>
      new Promise((_answer, refuse) => {
        signal.addEventListener('abort', () => {
          refuse(new Error('the ping was given up', { cause: signal.reason }));
        });
      }),
  );
}

function optionsPingingThrough(pings: Pings, runtimeHome: string): ServerOptions<never> {
  return {
    ...defaultServerOptions,
    usagePing: usagePingOf({ fetch: pings.fetch, runtimeHome, running: process }),
  };
}

function settingsIn(folder: string, environment: Environment = {}): Environment {
  return { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: join(folder, 'ledger.db'), ...environment };
}

async function landingPageOf(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: 'text/html' } });
  return response.text();
}

function abortOfTheFirst({ signals }: Pings): Promise<unknown> {
  const [first] = signals;
  return first === undefined ? Promise.reject(new Error('no usage ping was sent')) : once(first, 'abort');
}

async function announced(folder: string): Promise<readonly string[]> {
  const written: string[] = [];
  const never = Promise.withResolvers<void>().promise;
  const serverProcess = {
    env: settingsIn(folder),
    stdout: {
      write: (message: string) => {
        written.push(message);
      },
    },
    stderr: {
      write: (_message: string, flushed: () => void) => {
        flushed();
      },
    },
    exit: Function.constVoid,
  };
  const server = await runServer(serverProcess, optionsPingingThrough(answered(), folder), never, never);
  await server.stop();
  return written;
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

describe('the announcement of a server whose usage ping is on', () => {
  it('says after the port, at the first start alone, that it sends an anonymous usage ping', async () => {
    const folder = folderOfTheTest();

    const first = await announced(folder);
    const second = await announced(folder);

    expect(first.slice(1)).toEqual([`${firstStartNotice}\n`]);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatch(/^Auto Runtime listening on port \d+\n$/u);
  });
});
