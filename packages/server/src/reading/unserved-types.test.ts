import { withMcpSession } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const refusal = {
  reason: 'invalid_input',
  errors: [
    {
      pointer: '/type',
      detail: 'Expected a type this server runs: reasoning, interaction, computation, recall, prediction, or workflow',
    },
  ],
};

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
});

afterAll(async () => {
  await server.stop();
});

describe('a type the server does not run', () => {
  it('is refused at /type, naming the types it runs, by every operation that takes one over HTTP', async () => {
    const answers = await Promise.all([
      server.call('GET', `${alpha}/runs?type=forecast`),
      server.call('GET', `${alpha}/analytics?type=forecast`),
      server.call('GET', `${alpha}/definitions/forecast`),
      server.call('POST', `${alpha}/definitions/forecast/brief/run`, { body: { input: {} } }),
    ]);

    expect(answers.map(({ status }) => status)).toEqual([422, 422, 422, 422]);
    expect(answers.map(({ body }) => body)).toMatchObject([refusal, refusal, refusal, refusal]);
  });

  it('is refused the same way over MCP, as a result the agent can correct', async () => {
    const listed = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      (session) => session.callTool('list_runs', { type: 'forecast' }),
    );

    expect(listed.isError).toBe(true);
    expect(JSON.stringify(listed.content)).toContain(
      'Expected a type this server runs: reasoning, interaction, computation, recall, prediction, or workflow',
    );
  });
});
