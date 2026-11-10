import { describe, expect, it } from 'vitest';

import { askingASystem, openInput, type SystemServer } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70';

const page = 'x'.repeat(250_000);

const pages = ['a', 'b', 'c'];

function writing(name: string): string {
  return `${name}: { call: run_definition, with: { type: interaction, name: write-page, input: { path: ${name}.md, page: '\${ $workflow.input.page }' } } }`;
}

const atOnce = `do:
  - write:
      fork:
        branches:
${pages.map((name) => `          - ${writing(name)}\n`).join('')}`;

const inTurn = `do:\n${pages.map((name) => `  - ${writing(name)}\n`).join('')}`;

async function writtenBy(steps: string): Promise<{ readonly server: SystemServer; readonly started: unknown }> {
  const server = await askingASystem();
  await server.define('write-page', {
    tool: 'echo',
    read: '/path',
    with: ["    path: '{{ input.path }}'", "    content: '{{ input.page }}'"],
    input: openInput,
    output: ['output:', '  schema: { type: string }'],
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'pages', source: workflowSource('pages', steps) },
  });
  const started = await server.call('POST', `${alpha}/definitions/workflow/pages/run`, {
    body: { input: { page }, run_id: runId },
  });
  return { server, started: started.body };
}

const tooMuchAtOnce: unknown = expect.stringMatching(
  /^The run would record \d+ bytes at once, more than the 1572864 it may record at once; keep less across a wait, and start calls with large inputs one after another\.$/u,
);

describe('a workflow that writes three pages of 250,000 bytes through a function', () => {
  it('is rejected at its start, before any call, in words that say to start them one after another, when one step starts all three at once', async () => {
    const { server, started } = await writtenBy(atOnce);
    const read = await server.call('GET', `${alpha}/runs/${runId}`);

    expect(started).toMatchObject({ reason: 'unavailable', detail: tooMuchAtOnce });
    expect(read.body).toMatchObject({
      status: 'rejected',
      rejection: { detail: tooMuchAtOnce },
    });
    expect(server.fake.received()).toEqual([]);
  });

  it('writes each page whole when its steps start the calls one after another', async () => {
    const { server } = await writtenBy(inTurn);

    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: 'c.md' });
    expect(server.fake.received().map(({ arguments: written }) => written)).toEqual(
      pages.map((name) => ({ path: `${name}.md`, content: page })),
    );
  });
});
