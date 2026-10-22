import { createApiKey } from '@on.auto/identity';
import { describe, expect, it, onTestFinished } from 'vitest';

import { release } from '../composition/release.ts';
import { defaultServerOptions, startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  fakeStudioHost,
  pageTag,
  studioPage,
  studioScript,
  type FakeStudioHost,
} from '../testing/studios/fake-studio-host.ts';

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const userAgent = `auto-runtime/${release.version}`;

interface Opened {
  readonly status: number;
  readonly type: string | null;
  readonly caching: string | null;
  readonly policy: string | null;
  readonly text: string;
}

function aLedgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger.fileName;
}

async function aStudioHost(): Promise<FakeStudioHost> {
  const host = await fakeStudioHost();
  onTestFinished(() => host.close());
  return host;
}

async function serving(
  studioOrigin: string,
  ledgerFile: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<RunningServer> {
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledgerFile, STUDIO_ORIGIN: studioOrigin, ...environment },
    defaultServerOptions,
  );
  onTestFinished(() => server.stop());
  return server;
}

async function opened(
  { port }: RunningServer,
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Opened> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    caching: response.headers.get('cache-control'),
    policy: response.headers.get('content-security-policy'),
    text: await response.text(),
  };
}

describe('the Studio a runtime in local mode serves', () => {
  it("is the Studio host's page at /studio/ and at its routes, kept once and asked for again with its validator, by its path alone, with the runtime's user agent and none of the browser's credentials", async () => {
    const host = await aStudioHost();
    const server = await serving(host.origin, aLedgerFile());
    const fromABrowser = { cookie: 'session=a-cookie', authorization: 'Bearer a-token' };

    const root = await opened(server, '/studio/', fromABrowser);
    const route = await opened(server, '/studio/connect?connection=a-connection&token=a-link-token', fromABrowser);
    const again = await opened(server, '/studio/', fromABrowser);

    expect([root, route, again].map(({ status, type, text }) => [status, type, text])).toEqual([
      [200, 'text/html', studioPage],
      [200, 'text/html', studioPage],
      [200, 'text/html', studioPage],
    ]);
    expect(root.policy).toContain("script-src 'self'");
    expect(host.asked()).toEqual([
      { path: '/', userAgent, credentials: [undefined, undefined], validator: undefined },
      { path: '/connect', userAgent, credentials: [undefined, undefined], validator: pageTag },
      { path: '/', userAgent, credentials: [undefined, undefined], validator: pageTag },
    ]);
  });

  it('takes a page at its own origin as a page that may call it, and no other', async () => {
    const host = await aStudioHost();
    const server = await serving(host.origin, aLedgerFile());
    const own = `http://127.0.0.1:${server.port}`;

    expect([
      (await opened(server, '/nowhere', { origin: own })).status,
      (await opened(server, '/nowhere', { origin: 'http://127.0.0.1:3200' })).status,
    ]).toEqual([404, 403]);
  });
});

describe('the Studio a runtime in local mode kept', () => {
  it('holds the assets the host marks immutable and the page, beside the ledger, and serves them after a restart while the host is down, the page at a route never asked for too, and its own page for a file it never kept', async () => {
    const host = await aStudioHost();
    const ledgerFile = aLedgerFile();
    const first = await serving(host.origin, ledgerFile);
    await opened(first, '/studio/');
    await opened(first, '/studio/assets/index-4f2a9c.js');
    await first.stop();
    await host.close();

    const again = await serving(host.origin, ledgerFile);
    const asset = await opened(again, '/studio/assets/index-4f2a9c.js');
    const page = await opened(again, '/studio/');
    const route = await opened(again, '/studio/settings');
    const never = await opened(again, '/studio/assets/index-7c1d2e.css');

    expect([asset.status, asset.text, page.status, page.text, route.status, route.text, never.status]).toEqual([
      200,
      studioScript,
      200,
      studioPage,
      200,
      studioPage,
      503,
    ]);
    expect(asset.caching).toMatch(/^public, max-age=315\d{5}, immutable$/u);
    expect(never.text).toContain(`Auto Runtime serves Studio from ${host.origin}, which it cannot reach now`);
  });
});

describe('a runtime that takes keys', () => {
  it('serves no Studio, so /studio/ needs a key as every path does, unless SERVE_STUDIO is true, where it needs none', async () => {
    const host = await aStudioHost();
    const keys = { API_KEYS: JSON.stringify([entry]) };
    const closed = await serving(host.origin, aLedgerFile(), keys);
    const open = await serving(host.origin, aLedgerFile(), { ...keys, SERVE_STUDIO: 'true' });

    expect([(await opened(closed, '/studio/')).status, (await opened(open, '/studio/')).status]).toEqual([401, 200]);
  });
});
