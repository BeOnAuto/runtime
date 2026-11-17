import { openApiPath } from '@on.auto/api';
import { campaignPace } from '@on.auto/computation/testing';
import { packageDigest } from '@on.auto/definitions/portable';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
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

const contribution = [
  'contributes:',
  '  - goal: first-customer',
  '    purpose: Notes where the orders of the shop are posted.',
];

const noted = (channel: string, contributes: readonly string[] = contribution) =>
  [
    'document:',
    "  dsl: '1.0.3'",
    '  namespace: sales',
    '  name: noted',
    "  version: '1.0.0'",
    'do:',
    '  - noted:',
    '      set:',
    `        channel: ${channel}`,
    ...contributes,
  ].join('\n');

const askedFor = (change: string) =>
  `Ask the person: What is the value of the blank CHANNEL? The source still holds it on line 9; write the value in its place ${change}`;

const goalsBlanksWhereGoals = [
  '- id: first-customer',
  '  statement: Land the first paying customer for the shop.',
  '  success:',
  '    label: Paying customers',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Landed',
  '    failed: Missed',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

async function withAPlaybookBlanksWhereGoals<A>(
  serving: typeof servingReasoning,
  act: (server: ReasoningServer) => Promise<A>,
  kept: { readonly goals?: string } = {},
) {
  const server = await serving([]);
  try {
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha', ...kept } });
    return await act(server);
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

describe('a server that keeps goals', () => {
  it('refuses to create a workflow active, save it while active or resume it while its source holds a blank', async () => {
    const answers = await withAPlaybookBlanksWhereGoals(
      servingReasoningWithGoals,
      async ({ call }) => {
        const created = await call('POST', `${alpha}/definitions/workflow`, {
          body: { name: 'noted', source: noted('AUTO_BLANK_CHANNEL') },
        });
        await call('POST', `${alpha}/definitions/workflow`, { body: { name: 'noted', source: noted('C04ABC12DE') } });
        const updated = await call('PUT', `${alpha}/definitions/workflow/noted`, {
          body: { source: noted('AUTO_BLANK_CHANNEL') },
        });
        await call('POST', `${alpha}/definitions/workflow/noted/pause`, { body: {} });
        const savedPaused = await call('PUT', `${alpha}/definitions/workflow/noted`, {
          body: { source: noted('AUTO_BLANK_CHANNEL') },
        });
        const resumed = await call('POST', `${alpha}/definitions/workflow/noted/resume`, { body: {} });
        return [created, updated, savedPaused, resumed].map(({ status, body }) => [status, body]);
      },
      { goals: goalsBlanksWhereGoals },
    );

    expect(answers).toMatchObject([
      [409, { reason: 'conflict', detail: askedFor('before you create it') }],
      [
        409,
        {
          reason: 'conflict',
          detail: askedFor('before you save it, because an active definition cannot keep a blank'),
        },
      ],
      [200, { status: 'paused', version: 2 }],
      [409, { reason: 'conflict', detail: askedFor('with update_definition before you resume it') }],
    ]);
  });
});

describe('a server that does not keep goals', () => {
  it('creates a workflow whose source holds a blank as it creates any other', async () => {
    const created = await withAPlaybookBlanksWhereGoals(servingReasoning, ({ call }) =>
      call('POST', `${alpha}/definitions/workflow`, {
        body: { name: 'noted', source: noted('AUTO_BLANK_CHANNEL', []) },
      }),
    );

    expect([created.status, created.body]).toMatchObject([201, { status: 'active', version: 1 }]);
  });
});
