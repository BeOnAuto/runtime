import { answers, jsonResult } from '@on.auto/reasoning/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const definitions: readonly (readonly [string, string, string])[] = [
  ['reasoning', 'noted', '---\nmodel: anthropic/claude-sonnet-4-5\noutput:\n  shape: text\n---\nWrite a short note.'],
  [
    'computation',
    'noting',
    "---\nlanguage: typescript\noutput:\n  shape: text\n---\nexport default function (): Output {\n  return { text: 'A note.' };\n}",
  ],
  [
    'workflow',
    'kept-note',
    workflowSource('kept-note', "output:\n  shape: text\ndo:\n  - note:\n      set: { text: 'A note.' }\n"),
  ],
  [
    'interaction',
    'confirmed',
    '---\nto: owner\nexpires: P1D\ndeliver: agent\noutput:\n  schema:\n    type: object\n    required: [ok]\n    properties: { ok: { type: boolean } }\n---\nPlease confirm the note.',
  ],
];

const runIds: Readonly<Record<string, string>> = {
  reasoning: '0199a3c4-7d2e-7c1a-9b3f-888888888881',
  computation: '0199a3c4-7d2e-7c1a-9b3f-888888888882',
  workflow: '0199a3c4-7d2e-7c1a-9b3f-888888888883',
  interaction: '0199a3c4-7d2e-7c1a-9b3f-888888888884',
};

let server: ReasoningServer;

const runs: Record<string, unknown> = {};

function inTurn<Item>(items: readonly Item[], step: (item: Item) => Promise<unknown>): Promise<unknown> {
  return items.reduce<Promise<unknown>>((before, item) => before.then(() => step(item)), Promise.resolve());
}

async function readRun(type: string): Promise<void> {
  const path = `${alpha}/runs/${String(runIds[type])}`;
  const { body } = type === 'interaction' ? await server.call('GET', path) : await settledRun(server, path);
  runs[type] = body;
}

beforeAll(async () => {
  server = await servingReasoning([answers(jsonResult({ text: 'A short note.' }))]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await inTurn(definitions, ([type, name, source]) =>
    server.call('POST', `${alpha}/definitions/${type}`, {
      body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
    }),
  );
  await inTurn(definitions, ([type, name]) =>
    server.call('POST', `${alpha}/definitions/${type}/${name}/run`, { body: { input: {}, run_id: runIds[type] } }),
  );
  await inTurn(
    definitions.map(([type]) => type),
    readRun,
  );
});

afterAll(async () => {
  await server.stop();
});

describe('the shape a run says its output takes', () => {
  it('is the shape a reasoning function, a computation function or a workflow declares, on its run', () => {
    expect([runs['reasoning'], runs['computation'], runs['workflow']]).toMatchObject([
      { status: 'succeeded', output_shape: 'text', output: { text: 'A short note.' } },
      { status: 'succeeded', output_shape: 'text', output: { text: 'A note.' } },
      { status: 'succeeded', output_shape: 'text', output: { text: 'A note.' } },
    ]);
  });

  it('is none for a run of an interaction function, whose definition declares none', () => {
    expect(runs['interaction']).toMatchObject({ status: 'started' });
    expect(runs['interaction']).not.toHaveProperty('output_shape');
  });
});
