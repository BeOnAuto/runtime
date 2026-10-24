import { answeringFromTheTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const answeringWhatItSaw = answeringFromTheTools([['graph__profile', {}]], (texts) => textResult(texts.join('')));

const profiling = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/profile]', '---', 'Profile acme.'].join(
  '\n',
);

describe('what a call made by hand answers', () => {
  it('is the text the model of a run of a function that names the same tool sees of its answer', async () => {
    const graph = await serveFakeMcp({ bearer: apiKey });
    closing.push(graph.close);
    const server = await servingReasoning([answeringWhatItSaw], {
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
    });
    closing.push(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'profile', source: profiling } });

    const ran = await server.call('POST', `${alpha}/definitions/reasoning/profile/run`, { body: { input: {} } });
    const called = await server.call('POST', `${alpha}/tool-servers/graph/tools/profile/execute`, { body: {} });

    expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: '{"name":"Ada","rows":2}' } });
    expect(called).toMatchObject({ status: 200, body: { outcome: 'result', text: '{"name":"Ada","rows":2}' } });
    expect(graph.received().map(({ tool }) => tool)).toEqual(['profile', 'profile']);
  });
});
