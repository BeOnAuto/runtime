import { openApiPath } from '@on.auto/api';
import { campaignPace } from '@on.auto/computation/testing';
import { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, aMomentApart, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import type { LedgerOver } from '../testing/servers/served-parts.ts';
import { savedSourceOf, servingReasoningWithGoals, versionsOf } from '../testing/settings/goals-kept.ts';

const goals = [
  '- id: first-customer',
  '  statement: Land the first paying customer.',
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

function prompt(instruction: string, front: readonly string[] = []): string {
  return [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    ...front,
    'input:',
    '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
    '---',
    `${instruction}: {{ input.text }}`,
  ].join('\n');
}

const workflow = [
  'document:',
  "  dsl: '1.0.3'",
  '  namespace: sales',
  '  name: noted',
  "  version: '1.0.0'",
  'schedule:',
  '  every: PT1M',
  'do:',
  '  - noted:',
  '      set:',
  '        noted: true',
  'contributes:',
  '  - goal: first-customer',
  '    purpose: Notes each minute that the playbook is running.',
].join('\n');

const beta = '/v1/orgs/acme/playbooks/beta';

const importPath = '/v1/orgs/acme/playbooks/import';

const anotherPackage: unknown = expect.stringContaining('begun with another package');

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function serving(ledgerOver?: LedgerOver): Promise<ReasoningServer> {
  server = await servingReasoningWithGoals([], {}, undefined, ledgerOver === undefined ? {} : { ledgerOver });
  return server;
}

function reasoningNamed(name: string, front: readonly string[] = []) {
  return { type: 'reasoning', name, source: prompt(`Answer as ${name}`, front), diagram: 'none', paused: false };
}

function packageOf(definitions: readonly object[]) {
  return { format: 1, goals, definitions };
}

function importing(written: object, importId = 'import-one') {
  return { body: { playbook: 'beta', import_id: importId, title: 'Beta', package: written } };
}

async function aPlaybookWithItsMethod(made: ReasoningServer): Promise<void> {
  const call = aMomentApart(made);
  await call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha', goals } });
  await call('PUT', alpha, { body: { page } });
  await call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'answer', source: prompt('Answer'), diagram: 'none' },
  });
  await call('POST', `${alpha}/definitions/computation`, {
    body: { name: 'pace', source: campaignPace, diagram: 'none' },
  });
  await call('POST', `${alpha}/definitions/workflow`, { body: { name: 'noted', source: workflow } });
  await call('POST', `${alpha}/definitions/workflow/noted/pause`, { body: {} });
  await call('POST', `${alpha}/definitions/workflow/noted/resume`, { body: {} });
}

const ExportSchema = Schema.Struct({
  format: Schema.Number,
  page: Schema.String,
  goals: Schema.String,
  definitions: Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String, paused: Schema.Boolean })),
});

const ListedSchema = Schema.Struct({
  definitions: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
});

async function standingOf({ call }: ReasoningServer, type: string) {
  const { body } = await call('GET', `${beta}/definitions/${type}`);
  return Schema.decodeUnknownSync(ListedSchema)(body).definitions.map(({ name, status }) => `${name}:${status}`);
}

async function nothingOfBeta({ call }: ReasoningServer) {
  expect(await call('GET', beta)).toMatchObject({ status: 404 });
  expect(await call('GET', `${beta}/definitions/reasoning`)).toMatchObject({ status: 404 });
}

describe('an import on a server that keeps goals', () => {
  it('makes a copy of an exported playbook with its goals and its page, every definition paused, and nothing running', async () => {
    const running = await serving();
    await aPlaybookWithItsMethod(running);
    const { body: exportedBody } = await running.call('GET', `${alpha}/export`);
    const { definitions } = Schema.decodeUnknownSync(ExportSchema)(exportedBody);
    const {
      digest: _digest,
      needs: _needs,
      findings: _findings,
      ...exportedPackage
    } = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(exportedBody);

    const imported = await running.call('POST', importPath, importing(exportedPackage));

    expect(definitions.map(({ name, paused }) => [name, paused])).toEqual([
      ['answer', false],
      ['pace', false],
      ['noted', false],
    ]);
    expect(imported).toMatchObject({
      status: 201,
      body: {
        id: 'beta',
        name: 'Beta',
        status: 'active',
        page: { source: page },
        goals: { source: savedSourceOf(goals), versions: versionsOf(['first-customer', 1]) },
        models_not_offered: ['anthropic/claude-sonnet-4-5'],
      },
    });
    expect(await standingOf(running, 'reasoning')).toEqual(['answer:paused']);
    expect(await standingOf(running, 'computation')).toEqual(['pace:paused']);
    expect(await standingOf(running, 'workflow')).toEqual(['noted:paused']);
    expect(await running.call('GET', `${beta}/runs`)).toMatchObject({ status: 200, body: { runs: [] } });
  });
});

describe('an import refused on a server that keeps goals', () => {
  it('refuses a package whose definitions name a connection the org lacks, naming it, and writes nothing', async () => {
    const running = await serving();
    const written = packageOf([reasoningNamed('posts-in-chat', ['tools: [chat/send]'])]);

    expect(await running.call('POST', importPath, importing(written))).toMatchObject({
      status: 422,
      body: {
        errors: [
          {
            pointer: '/package/definitions',
            detail:
              'This org has no connection named chat, which reasoning/posts-in-chat use; connect it under that name, then import again',
          },
        ],
      },
    });
    await nothingOfBeta(running);
    expect(await running.call('POST', importPath, importing(packageOf([reasoningNamed('answer')])))).toMatchObject({
      status: 201,
    });
  });

  it('refuses a package with a definition a save refuses, or without goals, and writes nothing', async () => {
    const running = await serving();
    const refused = { type: 'workflow', name: 'broken', source: 'do: [', paused: false };

    expect(await running.call('POST', importPath, importing(packageOf([refused])))).toMatchObject({
      status: 422,
      body: { errors: [{ pointer: '/package/definitions/0/source' }] },
    });
    expect(await running.call('POST', importPath, importing({ format: 1, definitions: [] }))).toMatchObject({
      status: 422,
      body: { errors: [{ pointer: '/package/goals' }] },
    });
    await nothingOfBeta(running);
  });
});

describe('an import sent again on a server that keeps goals', () => {
  it('goes on after a cut that stopped it after two of five definitions, and ends with each once', async () => {
    const running = await serving(cuttingTheThirdDefinition);
    const written = packageOf(['one', 'two', 'three', 'four', 'five'].map((name) => reasoningNamed(`answer-${name}`)));

    expect(await running.call('POST', importPath, importing(written))).toMatchObject({ status: 500 });
    expect(await standingOf(running, 'reasoning')).toEqual(['answer-one:paused', 'answer-two:paused']);
    expect(await running.call('POST', importPath, importing(written))).toMatchObject({ status: 201 });
    expect(await standingOf(running, 'reasoning')).toEqual(
      ['five', 'four', 'one', 'three', 'two'].map((name) => `answer-${name}:paused`),
    );
    expect(await running.call('POST', importPath, importing(written))).toMatchObject({ status: 201 });
  });

  it('refuses another package under the same import_id, and an id that is taken', async () => {
    const running = await serving();
    await running.call('POST', importPath, importing(packageOf([reasoningNamed('answer')])));

    expect(await running.call('POST', importPath, importing(packageOf([reasoningNamed('reply')])))).toMatchObject({
      status: 409,
      body: { detail: anotherPackage },
    });
    await running.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'gamma', name: 'Gamma', goals } });
    const intoGamma = { body: { ...importing(packageOf([])).body, playbook: 'gamma', import_id: 'import-two' } };
    expect(await running.call('POST', importPath, intoGamma)).toMatchObject({
      status: 409,
      body: { detail: 'There is already a playbook gamma in this org' },
    });
  });
});

function cuttingTheThirdDefinition(ledger: Ledger['Service']): Ledger['Service'] {
  let created = 0;
  let cut = false;
  return Ledger.of({
    ...ledger,
    execute: (stream, decider, command, lineage) => {
      if (cut || !stream.endsWith('/definitions/reasoning')) {
        return ledger.execute(stream, decider, command, lineage);
      }
      created += 1;
      if (created < 3) {
        return ledger.execute(stream, decider, command, lineage);
      }
      cut = true;
      return Effect.die(new Error('The ledger stopped after two definitions'));
    },
  });
}

const DocumentSchema = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String })),
  paths: Schema.Record(Schema.String, Schema.Unknown),
});

async function documentServedBy(serve: typeof servingReasoning) {
  const served = await serve([]);
  try {
    const { body } = await served.call('GET', openApiPath);
    return Schema.decodeUnknownSync(DocumentSchema)(body);
  } finally {
    await served.stop();
  }
}

describe('the API document of a server that keeps goals', () => {
  it('documents the import among the playbooks, under no tag of its own', async () => {
    const without = await documentServedBy(servingReasoning);
    const withGoals = await documentServedBy(servingReasoningWithGoals);

    expect(withGoals.tags.filter(({ name }) => name !== 'goals')).toEqual(without.tags);
    expect(withGoals.paths['/orgs/{org}/playbooks/import']).toMatchObject({
      post: { operationId: 'import_playbook', tags: ['playbooks'] },
    });
    expect(without.paths).not.toHaveProperty(['/orgs/{org}/playbooks/import']);
  });
});

describe('a server that does not keep goals', () => {
  it('has no import route, and writes nothing', async () => {
    const running = await servingReasoning([]);
    try {
      expect(await running.call('POST', importPath, importing(packageOf([])))).toMatchObject({ status: 405 });
      expect(await running.call('GET', '/v1/orgs/acme/playbooks')).toMatchObject({ body: { playbooks: [] } });
    } finally {
      await running.stop();
    }
  });
});
