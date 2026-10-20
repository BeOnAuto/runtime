import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { release } from '../composition/release.ts';
import type { StartPing } from '../lifecycle/lifecycle.ts';
import type { LedgerSettings } from '../settings/ledger-settings.ts';
import type { UsagePingSettings } from './usage-ping-settings.ts';
import { firstStartNotice, usagePingOf, type PingFetch, type UsagePingHost } from './usage-ping.ts';

interface Ping {
  readonly url: string;
  readonly signal: AbortSignal;
}

interface Pings {
  readonly fetch: PingFetch;
  readonly sent: readonly Ping[];
}

const startPing = 'https://get.on.auto/runtime/start';

const linuxOnArm = { platform: 'linux', arch: 'arm64', versions: { node: '26.11.1' } };

function folderOfTheTest(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-usage-ping-'));
  onTestFinished(() => {
    chmodSync(folder, 0o700);
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function answeredWith(answer: (ping: Ping) => Promise<Response>): Pings {
  const sent: Ping[] = [];
  return {
    sent,
    fetch: (url, { signal }) => {
      sent.push({ url, signal });
      return answer({ url, signal });
    },
  };
}

function answered(): Pings {
  return answeredWith(() => Promise.resolve(new Response('', { status: 200 })));
}

function waitingForTheAbort(): Pings {
  return answeredWith(
    ({ signal }) =>
      new Promise((_answer, refuse) => {
        signal.addEventListener('abort', () => {
          refuse(new Error('the ping was given up', { cause: signal.reason }));
        });
      }),
  );
}

function hostOf(pings: Pings, runtimeHome: string): UsagePingHost {
  return { fetch: pings.fetch, runtimeHome, running: linuxOnArm };
}

function ledgerIn(folder: string): LedgerSettings {
  return { store: 'sqlite', file: join(folder, 'ledger.db') };
}

function startPingFor(host: UsagePingHost, usagePing: UsagePingSettings, ledger: LedgerSettings): StartPing {
  const ping = usagePingOf(host)({ usagePing, ledger });
  if (ping === undefined) {
    throw new Error('the usage ping is off');
  }
  return ping;
}

function signalOfTheFirst({ sent }: Pings): AbortSignal {
  const [first] = sent;
  if (first === undefined) {
    throw new Error('no usage ping was sent');
  }
  return first.signal;
}

describe('the usage ping a runtime sends once it listens', () => {
  it('names its release, platform, processor, Node.js, distribution and install', () => {
    const pings = answered();
    const folder = folderOfTheTest();

    const install = startPingFor(hostOf(pings, folder), { distribution: 'npx' }, ledgerIn(folder)).sent();

    expect(pings.sent.map(({ url }) => url)).toEqual([
      `${startPing}?version=${release.version}&platform=linux&arch=arm64&node=26.11.1&distribution=npx&install=${String(install?.id)}`,
    ]);
    expect(install?.isNew).toBe(true);
  });

  it('names the same install at every start, and says it is new only at the first', () => {
    const pings = answered();
    const folder = folderOfTheTest();

    const first = startPingFor(hostOf(pings, folder), { distribution: 'docker' }, ledgerIn(folder)).sent();
    const second = startPingFor(hostOf(pings, folder), { distribution: 'docker' }, ledgerIn(folder)).sent();

    expect(second).toEqual({ id: first?.id, isNew: false });
    expect(new Set(pings.sent.map(({ url }) => new URL(url).searchParams.get('install')))).toEqual(
      new Set([first?.id]),
    );
  });

  it('is not sent where the settings turn it off', () => {
    const pings = answered();
    const folder = folderOfTheTest();

    expect(usagePingOf(hostOf(pings, folder))({ usagePing: undefined, ledger: ledgerIn(folder) })).toBeUndefined();
    expect(pings.sent).toEqual([]);
  });
});

describe('the install a usage ping names', () => {
  it('is kept in the runtime home where the ledger has no file', () => {
    const runtimeHome = join(folderOfTheTest(), '.auto-runtime');
    const inMemory = { store: 'sqlite', file: ':memory:' } as const;

    const install = startPingFor(hostOf(answered(), runtimeHome), { distribution: 'source' }, inMemory).sent();

    expect(startPingFor(hostOf(answered(), runtimeHome), { distribution: 'source' }, inMemory).sent()).toEqual({
      id: install?.id,
      isNew: false,
    });
  });

  it('is none where none can be kept, and the ping is sent all the same', () => {
    const pings = answered();
    const folder = folderOfTheTest();
    chmodSync(folder, 0o500);

    const install = startPingFor(hostOf(pings, folder), { distribution: 'source' }, ledgerIn(folder)).sent();

    expect(install).toBeUndefined();
    expect(pings.sent.map(({ url }) => url)).toEqual([
      `${startPing}?version=${release.version}&platform=linux&arch=arm64&node=26.11.1&distribution=source`,
    ]);
  });

  it('is offered to the pages of the server once the ping is sent, and not before', () => {
    const folder = folderOfTheTest();
    const ping = startPingFor(hostOf(answered(), folder), { distribution: 'npx' }, ledgerIn(folder));

    const before = ping.installId();
    const install = ping.sent();

    expect([before, ping.installId()]).toEqual([undefined, install?.id]);
  });
});

describe('a usage ping that gets no answer', () => {
  it('gives up at its deadline', async () => {
    const pings = waitingForTheAbort();
    const folder = folderOfTheTest();

    usagePingOf(hostOf(pings, folder), 10)({ usagePing: { distribution: 'npx' }, ledger: ledgerIn(folder) })?.sent();
    const signal = signalOfTheFirst(pings);
    await once(signal, 'abort');

    expect(signal.reason).toMatchObject({ name: 'TimeoutError' });
  });

  it('gives up when the server stops, before its deadline', async () => {
    const pings = waitingForTheAbort();
    const folder = folderOfTheTest();
    const ping = startPingFor(hostOf(pings, folder), { distribution: 'npx' }, ledgerIn(folder));

    ping.sent();
    const signal = signalOfTheFirst(pings);
    const aborted = once(signal, 'abort');
    ping.stop();
    await aborted;

    expect(signal.reason).toMatchObject({ name: 'AbortError' });
  });
});

describe('a usage ping that fails', () => {
  it.each<readonly [string, PingFetch]>([
    ['the network refuses it', () => Promise.reject(new TypeError('fetch failed'))],
    [
      'the fetch throws',
      () => {
        throw new TypeError('fetch failed');
      },
    ],
    ['the answer has no body', () => Promise.resolve(new Response(null, { status: 404 }))],
  ])('neither throws nor rejects where %s', async (_case, fetch) => {
    const folder = folderOfTheTest();
    const { promise: tried, resolve: tryIt } = Promise.withResolvers<string>();
    const host = {
      ...hostOf(answered(), folder),
      fetch: (url: string, init: { readonly signal: AbortSignal }) => {
        tryIt(url);
        return fetch(url, init);
      },
    };

    expect(() => startPingFor(host, { distribution: 'npx' }, ledgerIn(folder)).sent()).not.toThrow();
    await expect(tried).resolves.toMatch(/^https:\/\/get\.on\.auto\/runtime\/start\?/u);
  });
});

describe('the notice of the first start', () => {
  it('says in one line that the ping is anonymous, how to turn it off and where to read more', () => {
    expect(firstStartNotice).toBe(
      'Auto Runtime sends an anonymous usage ping when it starts. To turn it off, set DO_NOT_TRACK=1 or USAGE_PING=false. https://on.auto/docs/self-host/configuration#usage-ping',
    );
  });
});
