import { openApiPath } from '@on.auto/api';
import { campaignPace } from '@on.auto/computation/testing';
import { packageDigest } from '@on.auto/definitions/portable';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const goals = [
  '- id: first-customer',
  '  statement: Land the first paying customer, as the people in #shop-orders count them.',
  '  success:',
  '    label: Paying customers',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Landed',
  '    failed: Missed',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const page = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    runs: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return { runs: { values: [...(view.runs?.values ?? []), { name: event.type, value: 1 }] } };',
  '    }',
  "runs: '{{ views.runs.values | size }} runs.'",
].join('\n');

const prompt = (instruction: string) =>
  [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'input:',
    '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
    '---',
    `${instruction}: {{ input.text }}`,
  ].join('\n');

const workflow = [
  'document:',
  "  dsl: '1.0.3'",
  '  namespace: sales',
  '  name: noted',
  "  version: '1.0.0'",
  'do:',
  '  - noted:',
  '      set:',
  '        channel: C04ABC12DE',
  'contributes:',
  '  - goal: first-customer',
  '    purpose: Notes where the orders of the shop are posted.',
].join('\n');

const webhook = 'https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnop';

const answer = {
  name: 'answer',
  source: prompt(`Answer the customer, and post a copy to ${webhook}`),
  overview: 'Answers the customer.\nA copy goes to orders@shop.example.',
  diagram: 'none',
};

const pace = { name: 'pace', source: campaignPace, diagram: 'none' };

const brief = { name: 'brief', source: prompt('Summarize'), diagram: 'none' };

async function withAPlaybook<A>(serving: typeof servingReasoning, act: (server: ReasoningServer) => Promise<A>) {
  const server = await serving([]);
  try {
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha', goals } });
    return await act(server);
  } finally {
    await server.stop();
  }
}

async function aPlaybookWithItsMethod({ call }: ReasoningServer): Promise<void> {
  await call('PUT', alpha, { body: { page } });
  await call('POST', `${alpha}/definitions/reasoning`, { body: answer });
  await call('POST', `${alpha}/definitions/reasoning`, { body: brief });
  await call('POST', `${alpha}/definitions/computation`, { body: pace });
  await call('POST', `${alpha}/definitions/workflow`, { body: { name: 'noted', source: workflow } });
  await call('POST', `${alpha}/definitions/reasoning/brief/pause`, { body: { reason: 'Quiet week' } });
  await call('POST', `${alpha}/definitions/workflow/noted/pause`, { body: {} });
}

const exportedPackage = {
  format: 1,
  page,
  goals,
  definitions: [
    { type: 'reasoning', ...answer, paused: false },
    { type: 'reasoning', ...brief, paused: true },
    { type: 'computation', ...pace, paused: false },
    { type: 'workflow', name: 'noted', source: workflow, paused: true },
  ],
};

const FindingsSchema = Schema.Struct({
  findings: Schema.Array(Schema.Struct({ class: Schema.String, value: Schema.String })),
});

const DocumentSchema = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String })),
  paths: Schema.Record(Schema.String, Schema.Unknown),
});

const exportPath = '/orgs/{org}/playbooks/{playbook}/export';

async function documentServedBy(serving: typeof servingReasoning) {
  const server = await serving([]);
  try {
    const { body } = await server.call('GET', openApiPath);
    return Schema.decodeUnknownSync(DocumentSchema)(body);
  } finally {
    await server.stop();
  }
}

describe('the export of a playbook on a server that keeps goals', () => {
  it('answers its page, its goals and its active and paused definitions, what they need and what may be private', async () => {
    const exported = await withAPlaybook(servingReasoningWithGoals, async (server) => {
      await aPlaybookWithItsMethod(server);
      return server.call('GET', `${alpha}/export`);
    });
    const { findings } = Schema.decodeUnknownSync(FindingsSchema)(exported.body);

    expect(exported).toMatchObject({
      status: 200,
      body: {
        ...exportedPackage,
        digest: packageDigest(exportedPackage),
        needs: {
          connections: [],
          types: ['computation', 'reasoning', 'workflow'],
          models: ['anthropic/claude-sonnet-4-5'],
        },
      },
    });
    expect(findings.map((finding) => [finding.class, finding.value])).toEqual(
      expect.arrayContaining([
        ['secret', webhook],
        ['address', 'orders@shop.example'],
        ['id', 'C04ABC12DE'],
        ['handle', '#shop-orders'],
      ]),
    );
  });
});

describe('the API document of a server that keeps goals', () => {
  it('documents the export among the playbooks, under no tag of its own', async () => {
    const without = await documentServedBy(servingReasoning);
    const withGoals = await documentServedBy(servingReasoningWithGoals);

    expect(withGoals.tags.filter(({ name }) => name !== 'goals')).toEqual(without.tags);
    expect(withGoals.paths[exportPath]).toMatchObject({
      get: { operationId: 'export_playbook', tags: ['playbooks'] },
    });
    expect(without.paths).not.toHaveProperty([exportPath]);
  });
});

describe('a server that does not keep goals', () => {
  it('has no export route', async () => {
    const server = await servingReasoning([]);
    try {
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      expect(await server.call('GET', `${alpha}/export`)).toMatchObject({ status: 404 });
    } finally {
      await server.stop();
    }
  });
});
