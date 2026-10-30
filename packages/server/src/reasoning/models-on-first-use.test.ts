import { makeModelAccess } from '@on.auto/reasoning';
import { jsonResponse } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRootWith } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import type { RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';
import { alpha, loopbackSettingsOver } from '../testing/servers/reasoning-server.ts';

const greeting = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Say hello.'].join('\n');

function listingNothing(): Promise<Response> {
  return Promise.resolve(jsonResponse({ data: [], has_more: false }));
}

function servingCounted(composing: () => void): Promise<RunningServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return startServer(
    { ...loopbackSettingsOver(ledger), ANTHROPIC_API_KEY: 'sk-ant-test-key' },
    compositionRootWith((settings) =>
      Effect.suspend(() => {
        composing();
        return makeModelAccess(settings, { fetch: listingNothing });
      }),
    ),
  );
}

describe('the models reasoning functions call', () => {
  it('are composed when a request first needs them, not at the start nor for a definition saved, and kept', async () => {
    const composings = { count: 0 };
    const server = await servingCounted(() => {
      composings.count += 1;
    });
    const atStart = composings.count;
    await request(server.port, 'POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await request(server.port, 'POST', `${alpha}/definitions/reasoning`, { body: { name: 'hello', source: greeting } });
    const afterTheSave = composings.count;

    const listed = [
      await request(server.port, 'GET', '/v1/orgs/acme/models'),
      await request(server.port, 'GET', '/v1/orgs/acme/models'),
    ];
    await server.stop();

    expect({ atStart, afterTheSave, listed: listed.map(({ status }) => status), composed: composings.count }).toEqual({
      atStart: 0,
      afterTheSave: 0,
      listed: [200, 200],
      composed: 1,
    });
  });
});
