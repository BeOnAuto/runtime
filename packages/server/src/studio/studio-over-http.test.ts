import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Option, Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { release } from '../composition/release.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import type { RunningServer } from '../server-options/server-options.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import {
  fakeStudioHost,
  type FakeStudioHost,
  pageTag,
  studioPage,
  studioScript,
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
  const serverStudio = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledgerFile, STUDIO_ORIGIN: studioOrigin, ...environment },
    defaultServerOptions,
  );
  onTestFinished(() => serverStudio.stop());
  return serverStudio;
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

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function summaryWith(instruction: string): string {
  return [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'input:',
    '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
    '---',
    `${instruction}: {{ input.text }}`,
  ].join('\n');
}

const asked = {
  playbook: { playbook: 'alpha', name: 'Alpha' },
  created: { name: 'summary', source: summaryWith('Summarize'), diagram: 'none' },
  updated: { source: summaryWith('Summarize briefly'), diagram: 'none' },
  run: { input: { text: 'the quarter' }, run_id: runId },
};

let server: ReasoningServer;

const studioIn = Schema.decodeUnknownOption(Schema.Struct({ studio: Schema.String }));

function studioOf(answer: unknown): string | undefined {
  return Option.getOrUndefined(Option.map(studioIn(answer), ({ studio }) => studio));
}

const definitionIdOf = Schema.decodeUnknownSync(Schema.Struct({ definition_id: Schema.String }));

function pagesOf(studioWithServer: string, saved: unknown): readonly string[] {
  const playbook = `${studioWithServer}&src=agent&playbook=alpha`;
  const summary = `${playbook}&reasoning=summary&definition=${definitionIdOf(saved).definition_id}`;
  return [
    playbook,
    `${summary}&because=created&version=1`,
    `${summary}&because=updated&version=2`,
    `${playbook}&ledger=&run=${runId}`,
  ];
}

describe('the Studio a runtime in local mode serves', () => {
  it("is the Studio host's page at /studio/ and at its routes, kept once and asked for again with its validator, by its path alone, with the runtime's user agent and none of the browser's credentials", async () => {
    const host = await aStudioHost();
    const serverStudio = await serving(host.origin, aLedgerFile());
    const fromABrowser = { cookie: 'session=a-cookie', authorization: 'Bearer a-token' };

    const root = await opened(serverStudio, '/studio/', fromABrowser);
    const route = await opened(
      serverStudio,
      '/studio/connect?connection=a-connection&token=a-link-token',
      fromABrowser,
    );
    const again = await opened(serverStudio, '/studio/', fromABrowser);

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
    const serverStudio = await serving(host.origin, aLedgerFile());
    const own = `http://127.0.0.1:${serverStudio.port}`;

    expect([
      (await opened(serverStudio, '/nowhere', { origin: own })).status,
      (await opened(serverStudio, '/nowhere', { origin: 'http://127.0.0.1:3200' })).status,
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

describe('studio links', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the links to Studio in what the runtime answers over HTTP', () => {
    it('are the pages of the playbook created, of its function by its id as it is saved and of its run, in the Studio the runtime serves', async () => {
      server = await servingReasoning([answers(textResult('Profits rose.'))]);
      const playbook = '/v1/orgs/local/playbooks/alpha';

      const answered = [
        await server.call('POST', '/v1/orgs/local/playbooks', { body: asked.playbook }),
        await server.call('POST', `${playbook}/definitions/reasoning`, { body: asked.created }),
        await server.call('PUT', `${playbook}/definitions/reasoning/summary`, { body: asked.updated }),
        await server.call('POST', `${playbook}/definitions/reasoning/summary/run`, { body: asked.run }),
      ];

      expect(answered.map(({ body }) => studioOf(body))).toEqual(
        pagesOf(`${server.origin}/studio/?server=${encodeURIComponent(server.origin)}`, answered[1]?.body),
      );
    });
  });

  describe('the links to Studio in what the runtime answers over MCP', () => {
    it('are the same pages, on the Studio host where the runtime serves no Studio', async () => {
      server = await servingReasoning([answers(textResult('Profits rose.'))], {
        API_KEYS: JSON.stringify([acmeAdmin.entry]),
      });
      const inAlpha = { playbook: 'alpha', type: 'reasoning' };

      const answered = await withMcpSession(
        'current revision',
        { url: `${server.origin}/mcp`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
        async (session) => [
          await session.callTool('create_playbook', asked.playbook),
          await session.callTool('create_definition', { ...inAlpha, ...asked.created }),
          await session.callTool('update_definition', { ...inAlpha, name: 'summary', ...asked.updated }),
          await session.callTool('run_definition', { ...inAlpha, name: 'summary', ...asked.run }),
        ],
      );

      expect(answered.map(({ structuredContent }) => studioOf(structuredContent))).toEqual(
        pagesOf(`https://studio.on.auto/?server=${encodeURIComponent(server.origin)}`, answered[1]?.structuredContent),
      );
    });
  });
});
