import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'billing-api-key-5c2e8d1f';

const runtime = `auto-runtime/${release.version}`;

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('the requests the server makes to its tool servers', () => {
  it('name the command of the runtime and its release as their User-Agent, but on the calls of an entry that writes its own', async () => {
    const billing = await serveFakeApi({ key: apiKey });
    closing.push(billing.close);
    const entry = { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: 'acme' };
    const own = { ...entry, headers: { 'User-Agent': 'operator-agent/2.0' } };
    const server = await servingReasoning([], {
      BILLING_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({ billing: entry, ledger: own }),
    });
    closing.push(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const search = { body: { arguments: { query: 'acme' } } };

    const called = [
      await server.call('POST', `${alpha}/tool-servers/billing/tools/search/execute`, search),
      await server.call('POST', `${alpha}/tool-servers/ledger/tools/search/execute`, search),
    ];

    expect(called.map(({ status }) => status)).toEqual([200, 200]);
    expect(billing.heard().map(({ path, userAgent }) => [path, userAgent])).toEqual([
      ['/openapi.json', runtime],
      ['/openapi.json', runtime],
      ['/v1/search?query=acme', runtime],
      ['/v1/search?query=acme', 'operator-agent/2.0'],
    ]);
  });
});
