import { stripVTControlCharacters } from 'node:util';

import type { SignInSettings } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import type { Install } from '../lifecycle/lifecycle.ts';
import type { ColorDepth } from '../logging/terminal.ts';
import { servedLocally, type LocalServerHost } from './local-server.ts';

interface Served {
  readonly host: LocalServerHost;
  readonly written: string[];
  readonly stop: () => void;
  readonly stops: () => number;
  readonly tick: () => void;
  readonly spinning: () => boolean;
}

interface Options {
  readonly depth?: ColorDepth;
  readonly run?: LocalServerHost['run'];
  readonly signIn?: SignInSettings;
  readonly install?: Install;
}

function stoppable(count: () => void, signIn?: SignInSettings, install?: Install): ReturnType<LocalServerHost['run']> {
  return Promise.resolve({
    port: 5600,
    mode: signIn === undefined ? 'local' : 'credentials',
    signIn,
    studio: { origin: 'https://studio.on.auto', served: signIn === undefined },
    install,
    stop: () => {
      count();
      return Promise.resolve();
    },
  });
}

function served({ depth = 1, run, signIn, install }: Options = {}): Served {
  const written: string[] = [];
  const { promise: stopRequested, resolve: stop } = Promise.withResolvers<void>();
  const clock = [1000, 1640];
  let stops = 0;
  const ticks: (() => void)[] = [];
  let spinning = false;
  return {
    written,
    stop,
    stops: () => stops,
    tick: () => {
      for (const tick of ticks) {
        tick();
      }
    },
    spinning: () => spinning,
    host: {
      depth,
      write: (text) => {
        written.push(text);
      },
      clock: () => clock.shift() ?? 0,
      tickEvery: (milliseconds, tick) => {
        expect(milliseconds).toBe(80);
        ticks.push(tick);
        spinning = true;
        return () => {
          spinning = false;
        };
      },
      run:
        run ??
        (() =>
          stoppable(
            () => {
              stops += 1;
            },
            signIn,
            install,
          )),
      stopRequested,
    },
  };
}

describe('serving the runtime on this computer', () => {
  it('shows the header, then the ready notice with the port, the time it took and local mode, and stops when asked', async () => {
    const local = served();

    const serving = servedLocally(local.host);
    await expect.poll(() => local.written).toHaveLength(2);
    local.stop();
    await serving;

    expect(local.written[0]).toBe(`\nAuto Runtime v${release.version}\nRuns the playbooks your agent builds\n\n`);
    expect(local.written[1]).toContain('  ✔ Ready in 640 ms\n');
    expect(local.written[1]).toContain('     Server   http://localhost:5600\n');
    expect(local.written[1]).not.toContain('Sign-in');
    expect(local.written[1]).toContain(
      '  Local mode: anyone on this computer acts as you, with no sign-in.\n  Set PUBLIC_URL=http://localhost:5600, and no ACCESS_MODE, to sign people in.\n',
    );
    expect(local.written.slice(2)).toEqual(['\n  Stopping…\n', '  ✔ Stopped\n']);
    expect(local.stops()).toBe(1);
  });

  it('shows the identity service persons sign in through when the server signs them in', async () => {
    const local = served({ signIn: { issuer: 'https://clerk.on.auto', publicUrl: 'http://localhost:5600' } });

    const serving = servedLocally(local.host);
    await expect.poll(() => local.written).toHaveLength(2);
    local.stop();
    await serving;

    expect(local.written[1]).toContain(
      '     MCP      http://localhost:5600/mcp\n     Sign-in  https://clerk.on.auto\n',
    );
    expect(local.written[1]).not.toContain('Local mode');
  });

  it('fails as the server failed to start, after the header', async () => {
    const local = served({ run: () => Promise.reject(new Error('port 5600 is in use')) });

    await expect(servedLocally(local.host)).rejects.toThrow('port 5600 is in use');
    expect(local.written).toHaveLength(1);
  });
});

describe('serving the runtime on this computer for the first time', () => {
  it('says in the ready notice that it sends a usage ping, the first time it starts', async () => {
    const local = served({ install: { id: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b', isNew: true } });

    const serving = servedLocally(local.host);
    await expect.poll(() => local.written).toHaveLength(2);
    local.stop();
    await serving;

    expect(local.written[1]).toContain('  Auto Runtime sends an anonymous usage ping when it starts.');
  });
});

describe('the spinner while the runtime starts at a terminal', () => {
  it('turns on its line until the server is ready, then clears it for the ready notice', async () => {
    const { promise: listening, resolve: listen } = Promise.withResolvers<void>();
    const local = served({
      depth: 24,
      run: async () => {
        await listening;
        return stoppable(() => {
          listen();
        });
      },
    });

    const serving = servedLocally(local.host);
    local.tick();
    local.tick();
    listen();
    await expect.poll(() => local.written).toHaveLength(6);
    local.stop();
    await serving;

    expect(local.written.slice(1, 4).map((text) => stripVTControlCharacters(text))).toEqual([
      '\r  ⠋ Starting…',
      '\r  ⠙ Starting…',
      '\r  ⠹ Starting…',
    ]);
    expect(local.written[4]).toBe('\r\u001B[2K');
    expect(stripVTControlCharacters(String(local.written[5]))).toMatch(/^ {2}✔ Ready in 640 ms\n/u);
    expect(local.spinning()).toBe(false);
  });

  it('stops and clears its line when the server fails to start', async () => {
    const local = served({ depth: 24, run: () => Promise.reject(new Error('port 5600 is in use')) });

    await expect(servedLocally(local.host)).rejects.toThrow('port 5600 is in use');
    expect(local.written.at(-1)).toBe('\r\u001B[2K');
    expect(local.spinning()).toBe(false);
  });
});
