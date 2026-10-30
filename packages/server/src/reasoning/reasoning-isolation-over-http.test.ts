import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, playbooks: '*' });

const summary = '---\nmodel: anthropic/claude-sonnet-4-5\n---\nSummarize {{ input.text }}';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([answers(textResult('Done'))], {
    API_KEYS: JSON.stringify([acmeAdmin.entry, globexAdmin.entry]),
  });
  const acme = { key: acmeAdmin.key };
  await server.call('POST', '/v1/orgs/acme/playbooks', { ...acme, body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', '/v1/orgs/acme/playbooks', { ...acme, body: { playbook: 'beta', name: 'Beta' } });
  await server.call('POST', '/v1/orgs/globex/playbooks', {
    key: globexAdmin.key,
    body: { playbook: 'alpha', name: 'Globex alpha' },
  });
  await server.call('POST', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning', {
    ...acme,
    body: { name: 'summary', source: summary },
  });
  await server.call('POST', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning/summary/run', {
    ...acme,
    body: { input: { text: 'the quarter' }, run_id: runId },
  });
});

afterEach(async () => {
  await server.stop();
});

describe('a reasoning function definition of one playbook', () => {
  it('is invisible from another playbook of the same org', async () => {
    const beta = '/v1/orgs/acme/playbooks/beta';
    const options = { key: acmeAdmin.key };

    expect(await server.call('GET', `${beta}/definitions/reasoning`, options)).toMatchObject({
      status: 200,
      body: { definitions: [] },
    });
    expect(await server.call('GET', `${beta}/definitions/reasoning/summary`, options)).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
    expect(
      await server.call('POST', `${beta}/definitions/reasoning/summary/run`, { ...options, body: { input: {} } }),
    ).toMatchObject({ status: 404 });
    expect(await server.call('GET', `${beta}/runs/${runId}`, options)).toMatchObject({ status: 404 });
  });

  it('is invisible from a playbook of the same id in another org, and forbidden to its keys', async () => {
    const globexAlpha = '/v1/orgs/globex/playbooks/alpha';
    const globex = { key: globexAdmin.key };

    expect(await server.call('GET', `${globexAlpha}/definitions/reasoning`, globex)).toMatchObject({
      status: 200,
      body: { definitions: [] },
    });
    expect(await server.call('GET', `${globexAlpha}/runs/${runId}`, globex)).toMatchObject({
      status: 404,
    });
    expect(
      await server.call('GET', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning/summary', globex),
    ).toMatchObject({
      status: 403,
      body: { reason: 'forbidden' },
    });
    expect(server.modelCalls()).toBe(1);
  });
});
