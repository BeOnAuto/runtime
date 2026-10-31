import { answers, jsonResult } from '@on.auto/reasoning/testing';
import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { inState, standingUntil } from '../testing/servers/recall-server.ts';
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
  [
    'recall',
    'counted',
    recallDocument(
      foldOf('return view + 1;'),
      'language: typescript\nsource:\n  events:\n    - type: run_succeeded\nview:\n  initial: 0',
    ),
  ],
];

const runIds: Readonly<Record<string, string>> = {
  reasoning: '0199a3c4-7d2e-7c1a-9b3f-888888888881',
  computation: '0199a3c4-7d2e-7c1a-9b3f-888888888882',
  workflow: '0199a3c4-7d2e-7c1a-9b3f-888888888883',
  interaction: '0199a3c4-7d2e-7c1a-9b3f-888888888884',
  recall: '0199a3c4-7d2e-7c1a-9b3f-888888888885',
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
    server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source } }),
  );
  await inTurn(definitions.slice(0, 4), ([type, name]) =>
    server.call('POST', `${alpha}/definitions/${type}/${name}/run`, { body: { input: {}, run_id: runIds[type] } }),
  );
  await standingUntil(server, 'counted', inState('live'));
  await server.call('POST', `${alpha}/definitions/recall/counted/run`, {
    body: { input: {}, run_id: runIds['recall'] },
  });
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

  it('is none for a run of an interaction function or a recall function, whose definitions declare none', () => {
    expect([runs['interaction'], runs['recall']]).toMatchObject([{ status: 'started' }, { status: 'succeeded' }]);
    expect(runs['interaction']).not.toHaveProperty('output_shape');
    expect(runs['recall']).not.toHaveProperty('output_shape');
  });
});
