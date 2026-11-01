import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

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

afterEach(async () => {
  await server.stop();
});

const studioIn = Schema.decodeUnknownOption(Schema.Struct({ studio: Schema.String }));

function studioOf(answer: unknown): string | undefined {
  return Option.getOrUndefined(Option.map(studioIn(answer), ({ studio }) => studio));
}

function pagesOf(studioWithServer: string): readonly string[] {
  const playbook = `${studioWithServer}&src=agent&playbook=alpha`;
  return [playbook, `${playbook}&reasoning=summary`, `${playbook}&reasoning=summary`, `${playbook}&run=${runId}`];
}

describe('the links to Studio in what the runtime answers over HTTP', () => {
  it('are the pages of the playbook created, of its function as it is saved and of its run, in the Studio the runtime serves', async () => {
    server = await servingReasoning([answers(textResult('Profits rose.'))]);
    const playbook = '/v1/orgs/local/playbooks/alpha';

    const answered = [
      await server.call('POST', '/v1/orgs/local/playbooks', { body: asked.playbook }),
      await server.call('POST', `${playbook}/definitions/reasoning`, { body: asked.created }),
      await server.call('PUT', `${playbook}/definitions/reasoning/summary`, { body: asked.updated }),
      await server.call('POST', `${playbook}/definitions/reasoning/summary/run`, { body: asked.run }),
    ];

    expect(answered.map(({ body }) => studioOf(body))).toEqual(
      pagesOf(`${server.origin}/studio/?server=${encodeURIComponent(server.origin)}`),
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
      pagesOf(`https://studio.on.auto/?server=${encodeURIComponent(server.origin)}`),
    );
  });
});
