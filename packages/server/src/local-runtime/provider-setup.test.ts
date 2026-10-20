import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';
import { providerSetupFor, restartWordsFor } from './local-control.ts';

const setup = providerSetupFor('/Users/ada/.auto-runtime', restartWordsFor({ port: undefined, version: '0.9.1' }));

const review = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Review {{ input.brief }}.'].join('\n');

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      ...noConsentThroughAuto,
    },
    { ...compositionRoot, localServingIn: () => ({ providerSetup: setup }) },
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

describe('a runtime on this computer with no model provider', () => {
  it('tells an agent that lists its models where the person puts their key', async () => {
    const listed = await withMcpSession(
      'current revision',
      { url: `http://127.0.0.1:${server.port}/mcp`, headers: {} },
      (session) => session.callTool('list_models', {}),
    );

    expect(plainTextIn(listed)).toContain(`This server has no model it can call. ${setup}`);
    expect(listed.structuredContent).toMatchObject({ data: [], provider_setup: setup });
  });

  it('tells it the same when a reasoning function cannot run', async () => {
    await request(server.port, 'POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await request(server.port, 'POST', `${alpha}/definitions/reasoning`, { body: { name: 'review', source: review } });

    const run = await request(server.port, 'POST', `${alpha}/definitions/reasoning/review/run`, {
      body: { input: { brief: 'a brief' } },
    });

    expect(run.text).toContain(setup);
  });

  it('ends the guide to reasoning functions with it', async () => {
    const guide = await (await fetch(`http://127.0.0.1:${server.port}/v1/guides/reasoning-function`)).text();

    expect(guide.trimEnd().endsWith(setup)).toBe(true);
  });
});
