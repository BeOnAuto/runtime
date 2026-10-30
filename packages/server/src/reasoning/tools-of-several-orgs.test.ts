import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'billing-api-key-5c2e8d1f';

const searched = () => callingTools([['billing__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [billing/search]', '---', 'Count acme.'].join(
  '\n',
);

async function servingOrgs() {
  const billing = await serveFakeApi({ key: apiKey });
  onTestFinished(billing.close);
  const server = await servingReasoning([searched(), searched()], {
    BILLING_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      billing: { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: ['acme', 'globex'] },
    }),
  });
  onTestFinished(server.stop);
  await Promise.all(
    ['acme', 'globex', 'initech'].map(async (org) => {
      await server.call('POST', `/v1/orgs/${org}/playbooks`, { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `/v1/orgs/${org}/playbooks/alpha/definitions/reasoning`, {
        body: { name: 'count', source },
      });
    }),
  );
  const run = (org: string) =>
    server.call('POST', `/v1/orgs/${org}/playbooks/alpha/definitions/reasoning/count/run`, { body: { input: {} } });
  return { billing, run };
}

describe('a tool server that serves several orgs', () => {
  it('is one entry the functions of each org call under one name and one key, and an org it does not list is refused', async () => {
    const { billing, run } = await servingOrgs();

    const ran = [await run('acme'), await run('globex'), await run('initech')];

    expect(ran.map(({ status }) => status)).toEqual([200, 200, 503]);
    expect(ran.slice(0, 2).map(({ body }) => body)).toMatchObject([
      { status: 'succeeded', output: 'Acme has 2 rows.' },
      { status: 'succeeded', output: 'Acme has 2 rows.' },
    ]);
    expect(ran[2]?.body).toMatchObject({ kind: 'tool_not_offered', because: 'tool_server_not_configured' });
    expect(billing.seen().map(({ path, headers }) => [path, headers['x-api-key']])).toEqual([
      ['/v1/search', apiKey],
      ['/v1/search', apiKey],
    ]);
  });
});
